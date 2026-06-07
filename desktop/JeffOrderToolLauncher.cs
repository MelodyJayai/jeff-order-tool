using System;
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
}
