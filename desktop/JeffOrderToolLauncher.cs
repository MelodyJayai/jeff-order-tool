using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class JeffOrderToolLauncher
{
    private const int Port = 3000;
    private const string AppTitle = "Jeff订单工具";

    private sealed class ServerStart
    {
        public Process Process;
        public string LogPath;
    }

    private sealed class HealthStatus
    {
        public bool Ready;
        public bool IsJeffOrderTool;
        public bool IsCurrentInstance;
    }

    private sealed class MigrationCandidate
    {
        public string AppDir;
        public string DataDir;
        public string DbPath;
        public DateTime UpdatedAt;
        public long Size;
    }

    [STAThread]
    private static void Main()
    {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string expectedInstanceId = ComputeInstanceId(baseDir);
        string url = "http://127.0.0.1:" + Port;
        string healthUrl = url + "/api/health";

        try
        {
            HealthStatus health = GetHealthStatus(healthUrl, expectedInstanceId);

            if (!health.Ready || !health.IsCurrentInstance)
            {
                if (health.Ready && health.IsJeffOrderTool && !health.IsCurrentInstance)
                {
                    StopOtherJeffOrderServers(baseDir);
                    Thread.Sleep(1000);
                }

                TryMigratePortableData(baseDir);

                ServerStart server = StartServer(baseDir);

                if (!WaitUntilReady(healthUrl, expectedInstanceId, TimeSpan.FromSeconds(60), server.Process))
                {
                    string detail = ReadLogTail(server.LogPath);
                    string message = server.Process.HasExited
                        ? "后台服务启动失败。请查看 logs\\server.log。"
                        : "工具启动超时。请确认当前文件夹完整，稍后再试一次。";

                    if (detail.Length > 0)
                    {
                        message += Environment.NewLine + Environment.NewLine + detail;
                    }

                    MessageBox.Show(
                        message,
                        AppTitle,
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Warning);
                    return;
                }
            }

            OpenBrowser(url);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "启动失败：" + ex.Message,
                AppTitle,
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private static void TryMigratePortableData(string baseDir)
    {
        string dataDir = Path.Combine(baseDir, "data");
        string targetDb = Path.Combine(dataDir, "orders.db");
        string logPath = Path.Combine(baseDir, "logs", "migration.log");

        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(logPath));

            if (TargetHasExistingOrders(baseDir, targetDb, logPath))
            {
                LogMigration(logPath, "skip: target database already has orders");
                return;
            }

            MigrationCandidate candidate = FindBestMigrationCandidate(baseDir);

            if (candidate == null)
            {
                LogMigration(logPath, "skip: no portable data candidate found");
                return;
            }

            Directory.CreateDirectory(dataDir);

            if (DirectoryHasFiles(dataDir))
            {
                string backupDir = Path.Combine(
                    baseDir,
                    "data-before-portable-migration-" +
                    DateTime.Now.ToString("yyyyMMdd-HHmmss"));
                CopyDirectory(dataDir, backupDir);
                LogMigration(logPath, "backed up existing target data to " + backupDir);
            }

            CopyDirectory(candidate.DataDir, dataDir);
            LogMigration(
                logPath,
                "migrated data from " + candidate.DataDir +
                " size=" + candidate.Size.ToString() +
                " updatedAt=" + candidate.UpdatedAt.ToString("yyyy-MM-dd HH:mm:ss"));
        }
        catch (Exception ex)
        {
            LogMigration(logPath, "migration failed: " + ex);
            MessageBox.Show(
                "自动导入旧版数据失败：" + ex.Message +
                "\n\n可以先继续打开工具；如果订单没有显示，请保留旧绿色版文件夹，不要删除。",
                AppTitle,
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
        }
    }

    private static bool TargetHasExistingOrders(
        string baseDir,
        string targetDb,
        string logPath)
    {
        if (!File.Exists(targetDb) || new FileInfo(targetDb).Length <= 0)
        {
            return false;
        }

        int? count = TryReadOrderCount(baseDir, targetDb, logPath);

        if (count.HasValue)
        {
            return count.Value > 0;
        }

        LogMigration(
            logPath,
            "could not read target order count; keeping existing database safe");
        return true;
    }

    private static int? TryReadOrderCount(
        string baseDir,
        string targetDb,
        string logPath)
    {
        string nodeExe = Path.Combine(baseDir, "runtime", "node.exe");
        string serverDir = Path.Combine(baseDir, "server");

        if (!File.Exists(nodeExe) || !Directory.Exists(serverDir))
        {
            return null;
        }

        string scriptPath = Path.Combine(baseDir, "logs", "read-order-count.js");
        string script =
            "const Database = require('better-sqlite3');\n" +
            "const db = new Database(process.argv[2], { readonly: true, fileMustExist: true });\n" +
            "let count = 0;\n" +
            "const row = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='orders'\").get();\n" +
            "if (row) count = db.prepare(\"SELECT COUNT(*) AS count FROM orders\").get().count || 0;\n" +
            "db.close();\n" +
            "console.log(String(count));\n";

        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(scriptPath));
            File.WriteAllText(scriptPath, script, Encoding.UTF8);

            var info = new ProcessStartInfo
            {
                FileName = nodeExe,
                Arguments = QuoteForArgument(scriptPath) + " " + QuoteForArgument(targetDb),
                WorkingDirectory = serverDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };

            using (Process process = Process.Start(info))
            {
                if (process == null)
                {
                    return null;
                }

                if (!process.WaitForExit(5000))
                {
                    try
                    {
                        process.Kill();
                    }
                    catch
                    {
                    }

                    return null;
                }

                string output = process.StandardOutput.ReadToEnd().Trim();
                string error = process.StandardError.ReadToEnd().Trim();
                int count;

                if (error.Length > 0)
                {
                    LogMigration(logPath, "read-order-count stderr: " + error);
                }

                if (process.ExitCode == 0 && int.TryParse(output, out count))
                {
                    return count;
                }

                LogMigration(
                    logPath,
                    "read-order-count failed exit=" + process.ExitCode.ToString() +
                    " output=" + output);
                return null;
            }
        }
        catch (Exception ex)
        {
            LogMigration(logPath, "read-order-count exception: " + ex.Message);
            return null;
        }
        finally
        {
            try
            {
                File.Delete(scriptPath);
            }
            catch
            {
            }
        }
    }

    private static MigrationCandidate FindBestMigrationCandidate(string baseDir)
    {
        var candidates = new List<MigrationCandidate>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (string root in CandidateSearchRoots())
        {
            ScanForMigrationCandidates(root, baseDir, candidates, seen, 0, 5);
        }

        candidates.Sort(delegate(MigrationCandidate left, MigrationCandidate right)
        {
            int updated = right.UpdatedAt.CompareTo(left.UpdatedAt);

            if (updated != 0)
            {
                return updated;
            }

            return right.Size.CompareTo(left.Size);
        });

        return candidates.Count > 0 ? candidates[0] : null;
    }

    private static IEnumerable<string> CandidateSearchRoots()
    {
        var roots = new List<string>();
        string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        string documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        string oneDrive = Environment.GetEnvironmentVariable("OneDrive");

        AddRoot(roots, desktop);
        AddRoot(roots, Path.Combine(userProfile, "Desktop"));
        AddRoot(roots, Path.Combine(userProfile, "Downloads"));
        AddRoot(roots, documents);
        AddRoot(roots, Path.Combine(userProfile, "Documents"));
        AddRoot(roots, Path.Combine(userProfile, "OneDrive", "Desktop"));
        AddRoot(roots, Path.Combine(userProfile, "OneDrive", "Documents"));
        AddRoot(roots, @"D:\tools");
        AddRoot(roots, @"D:\tools\JeffOrderTool-v0.1.8");

        if (!string.IsNullOrWhiteSpace(oneDrive))
        {
            AddRoot(roots, Path.Combine(oneDrive, "Desktop"));
            AddRoot(roots, Path.Combine(oneDrive, "Documents"));
        }

        foreach (string drive in Environment.GetLogicalDrives())
        {
            AddRoot(roots, Path.Combine(drive, "tools"));
            AddRoot(roots, Path.Combine(drive, "Tools"));
        }

        return roots;
    }

    private static void AddRoot(List<string> roots, string path)
    {
        if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path))
        {
            return;
        }

        string fullPath = Path.GetFullPath(path);

        foreach (string item in roots)
        {
            if (SameDirectory(item, fullPath))
            {
                return;
            }
        }

        roots.Add(fullPath);
    }

    private static void ScanForMigrationCandidates(
        string directory,
        string baseDir,
        List<MigrationCandidate> candidates,
        HashSet<string> seen,
        int depth,
        int maxDepth)
    {
        if (depth > maxDepth || string.IsNullOrWhiteSpace(directory))
        {
            return;
        }

        try
        {
            if (!Directory.Exists(directory) || SameDirectory(directory, baseDir))
            {
                return;
            }

            TryAddMigrationCandidate(directory, baseDir, candidates, seen);

            foreach (string child in Directory.GetDirectories(directory))
            {
                if (ShouldSkipSearchDirectory(child, baseDir))
                {
                    continue;
                }

                ScanForMigrationCandidates(
                    child,
                    baseDir,
                    candidates,
                    seen,
                    depth + 1,
                    maxDepth);
            }
        }
        catch
        {
        }
    }

    private static void TryAddMigrationCandidate(
        string appDir,
        string baseDir,
        List<MigrationCandidate> candidates,
        HashSet<string> seen)
    {
        string dataDir = Path.Combine(appDir, "data");
        string dbPath = Path.Combine(dataDir, "orders.db");
        string runtimePath = Path.Combine(appDir, "runtime", "node.exe");
        string serverPath = Path.Combine(appDir, "server", "server.js");

        if (SameDirectory(appDir, baseDir) ||
            !File.Exists(dbPath) ||
            !File.Exists(runtimePath) ||
            !File.Exists(serverPath))
        {
            return;
        }

        string normalizedDb = Path.GetFullPath(dbPath);

        if (!seen.Add(normalizedDb))
        {
            return;
        }

        FileInfo db = new FileInfo(dbPath);

        if (db.Length <= 0)
        {
            return;
        }

        candidates.Add(new MigrationCandidate
        {
            AppDir = appDir,
            DataDir = dataDir,
            DbPath = dbPath,
            UpdatedAt = db.LastWriteTime,
            Size = db.Length,
        });
    }

    private static bool ShouldSkipSearchDirectory(string directory, string baseDir)
    {
        if (SameDirectory(directory, baseDir))
        {
            return true;
        }

        string name = Path.GetFileName(
            directory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));

        return
            name.Equals(".git", StringComparison.OrdinalIgnoreCase) ||
            name.Equals("node_modules", StringComparison.OrdinalIgnoreCase) ||
            name.Equals("AppData", StringComparison.OrdinalIgnoreCase) ||
            name.Equals("Windows", StringComparison.OrdinalIgnoreCase) ||
            name.Equals("$Recycle.Bin", StringComparison.OrdinalIgnoreCase);
    }

    private static bool DirectoryHasFiles(string directory)
    {
        if (!Directory.Exists(directory))
        {
            return false;
        }

        try
        {
            using (IEnumerator<string> files =
                Directory.EnumerateFiles(directory, "*", SearchOption.AllDirectories).GetEnumerator())
            {
                return files.MoveNext();
            }
        }
        catch
        {
            return false;
        }
    }

    private static void CopyDirectory(string source, string destination)
    {
        Directory.CreateDirectory(destination);

        foreach (string directory in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
        {
            string relative = directory.Substring(source.Length)
                .TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            Directory.CreateDirectory(Path.Combine(destination, relative));
        }

        foreach (string file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
        {
            string relative = file.Substring(source.Length)
                .TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string target = Path.Combine(destination, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(target));
            File.Copy(file, target, true);
        }
    }

    private static void LogMigration(string logPath, string message)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(logPath));
            File.AppendAllText(
                logPath,
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message +
                Environment.NewLine);
        }
        catch
        {
        }
    }

    private static ServerStart StartServer(string baseDir)
    {
        string nodeExe = Path.Combine(baseDir, "runtime", "node.exe");
        string serverDir = Path.Combine(baseDir, "server");
        string serverJs = Path.Combine(serverDir, "server.js");
        string dataDir = Path.Combine(baseDir, "data");
        string logsDir = Path.Combine(baseDir, "logs");
        string logPath = Path.Combine(logsDir, "server.log");

        if (!File.Exists(nodeExe))
        {
            throw new FileNotFoundException("找不到 runtime\\node.exe");
        }

        if (!File.Exists(serverJs))
        {
            throw new FileNotFoundException("找不到 server\\server.js");
        }

        Directory.CreateDirectory(dataDir);
        Directory.CreateDirectory(logsDir);
        File.AppendAllText(
            logPath,
            Environment.NewLine +
            "==== " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") +
            " starting JeffOrderTool ====" + Environment.NewLine);

        string command =
            QuoteForCmd(nodeExe) + " " + QuoteForCmd(serverJs) +
            " >> " + QuoteForCmd(logPath) + " 2>&1";

        File.AppendAllText(
            logPath,
            "node=" + nodeExe + Environment.NewLine +
            "server=" + serverJs + Environment.NewLine +
            "data=" + Path.Combine(dataDir, "orders.db") + Environment.NewLine +
            "port=" + Port.ToString() + Environment.NewLine);

        var info = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = "/d /c \"" + command + "\"",
            WorkingDirectory = serverDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };

        info.EnvironmentVariables["NODE_ENV"] = "production";
        info.EnvironmentVariables["PORT"] = Port.ToString();
        info.EnvironmentVariables["HOSTNAME"] = "0.0.0.0";
        info.EnvironmentVariables["JEFF_ORDER_DB_PATH"] =
            Path.Combine(dataDir, "orders.db");
        info.EnvironmentVariables["JEFF_APP_BASE_DIR"] = baseDir;

        Process process = Process.Start(info);

        if (process == null)
        {
            throw new InvalidOperationException("无法启动后台服务");
        }

        File.WriteAllText(Path.Combine(baseDir, "server.pid"), process.Id.ToString());
        return new ServerStart { Process = process, LogPath = logPath };
    }

    private static bool WaitUntilReady(
        string url,
        string expectedInstanceId,
        TimeSpan timeout,
        Process process)
    {
        DateTime deadline = DateTime.Now.Add(timeout);

        while (DateTime.Now < deadline)
        {
            if (process.HasExited)
            {
                return false;
            }

            if (GetHealthStatus(url, expectedInstanceId).IsCurrentInstance)
            {
                return true;
            }

            Thread.Sleep(500);
        }

        return false;
    }

    private static string ReadLogTail(string logPath)
    {
        try
        {
            if (!File.Exists(logPath))
            {
                return "";
            }

            string text = File.ReadAllText(logPath);
            int maxLength = 1200;

            if (text.Length <= maxLength)
            {
                return text.Trim();
            }

            return text.Substring(text.Length - maxLength).Trim();
        }
        catch
        {
            return "";
        }
    }

    private static HealthStatus GetHealthStatus(string url, string expectedInstanceId)
    {
        var status = new HealthStatus();

        try
        {
            var request = (HttpWebRequest)WebRequest.Create(url);
            request.Timeout = 1000;
            request.ReadWriteTimeout = 1000;

            using (var response = (HttpWebResponse)request.GetResponse())
            {
                if ((int)response.StatusCode < 200 || (int)response.StatusCode >= 500)
                {
                    return status;
                }

                using (var reader = new StreamReader(response.GetResponseStream()))
                {
                    string body = reader.ReadToEnd();
                    status.Ready = body.Contains("jeff-order-tool");
                    status.IsJeffOrderTool = status.Ready;
                    status.IsCurrentInstance =
                        status.Ready &&
                        body.Contains("\"instanceId\":\"" + expectedInstanceId + "\"");
                    return status;
                }
            }
        }
        catch
        {
            return status;
        }
    }

    private static void StopOtherJeffOrderServers(string currentBaseDir)
    {
        string script =
            "$current = " + QuoteForPowerShell(currentBaseDir) + "; " +
            "Get-CimInstance Win32_Process | Where-Object { " +
            "($_.Name -eq 'node.exe' -or $_.Name -eq 'cmd.exe') -and " +
            "$_.CommandLine -and " +
            "($_.CommandLine -like '*JeffOrderTool*' -or $_.CommandLine -like '*jeff-order-tool*' -or $_.CommandLine -like '*server.js*') -and " +
            "$_.CommandLine -notlike ('*' + $current + '*') " +
            "} | ForEach-Object { taskkill.exe /PID $_.ProcessId /T /F | Out-Null }";

        try
        {
            var info = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -ExecutionPolicy Bypass -Command " + QuoteForCmd(script),
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };

            using (Process process = Process.Start(info))
            {
                if (process != null)
                {
                    process.WaitForExit(8000);
                }
            }
        }
        catch
        {
        }
    }

    private static string ComputeInstanceId(string baseDir)
    {
        string normalized = Path.GetFullPath(baseDir)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            .ToLowerInvariant();

        using (SHA256 sha = SHA256.Create())
        {
            byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(normalized));
            var builder = new StringBuilder(hash.Length * 2);

            foreach (byte item in hash)
            {
                builder.Append(item.ToString("x2"));
            }

            return builder.ToString();
        }
    }

    private static void OpenBrowser(string url)
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = url,
            UseShellExecute = true,
        });
    }

    private static string QuoteForCmd(string value)
    {
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }

    private static string QuoteForPowerShell(string value)
    {
        return "'" + value.Replace("'", "''") + "'";
    }

    private static string QuoteForArgument(string value)
    {
        return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }

    private static bool SameDirectory(string left, string right)
    {
        if (string.IsNullOrWhiteSpace(left) || string.IsNullOrWhiteSpace(right))
        {
            return false;
        }

        string normalizedLeft = Path.GetFullPath(left)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        string normalizedRight = Path.GetFullPath(right)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

        return string.Equals(
            normalizedLeft,
            normalizedRight,
            StringComparison.OrdinalIgnoreCase);
    }
}
