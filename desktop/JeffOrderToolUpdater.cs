using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

internal static class JeffOrderToolUpdater
{
    private const string AppTitle = "Jeff订单工具更新";

    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length < 2)
        {
            MessageBox.Show(
                "更新参数不完整，请重新在 Jeff订单工具中点击更新。",
                AppTitle,
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
            return;
        }

        string installerPath = args[0];
        string appDir = args[1];
        string logPath = Path.Combine(appDir, "logs", "updater.log");

        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(logPath));
            Log(logPath, "update requested");
            Log(logPath, "installer=" + installerPath);
            Log(logPath, "appDir=" + appDir);

            if (!File.Exists(installerPath))
            {
                throw new FileNotFoundException("找不到已下载的安装包", installerPath);
            }

            if (!Directory.Exists(appDir))
            {
                throw new DirectoryNotFoundException("找不到安装目录：" + appDir);
            }

            Thread.Sleep(1500);
            StopServer(appDir, logPath);
            RunInstaller(installerPath, appDir, logPath);
            StartLauncher(appDir, logPath);
        }
        catch (Exception ex)
        {
            Log(logPath, "failed: " + ex);
            MessageBox.Show(
                "自动更新失败：" + ex.Message + "\n\n请查看 logs\\updater.log，或手动运行已下载的安装包。",
                AppTitle,
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
        }
    }

    private static void StopServer(string appDir, string logPath)
    {
        string pidPath = Path.Combine(appDir, "server.pid");

        if (File.Exists(pidPath))
        {
            string rawPid = File.ReadAllText(pidPath).Trim();
            int pid;

            if (int.TryParse(rawPid, out pid))
            {
                Log(logPath, "stopping pid=" + pid);
                RunProcess(
                    "taskkill.exe",
                    "/PID " + pid + " /T /F",
                    Path.GetDirectoryName(appDir),
                    logPath,
                    8000);
            }

            TryDelete(pidPath);
        }

        StopProcessesByAppDirectory(appDir, logPath);
        Thread.Sleep(1000);
    }

    private static void StopProcessesByAppDirectory(string appDir, string logPath)
    {
        string normalizedAppDir = Path.GetFullPath(appDir)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        string script =
            "$dir = " + QuoteForPowerShell(normalizedAppDir) + "\r\n" +
            "$escaped = $dir.Replace('\\','\\\\')\r\n" +
            "Get-CimInstance Win32_Process | Where-Object {\r\n" +
            "  ($_.Name -eq 'node.exe' -or $_.Name -eq 'cmd.exe') -and\r\n" +
            "  $_.CommandLine -and\r\n" +
            "  ($_.CommandLine -like ('*' + $dir + '*') -or\r\n" +
            "   $_.CommandLine -like ('*' + $escaped + '*'))\r\n" +
            "} | ForEach-Object { taskkill.exe /PID $_.ProcessId /T /F | Out-Null }\r\n";
        string scriptPath = Path.Combine(appDir, "logs", "stop-update-processes.ps1");

        try
        {
            File.WriteAllText(scriptPath, script);
            Log(logPath, "stopping processes under app directory");
            RunProcess(
                "powershell.exe",
                "-NoProfile -ExecutionPolicy Bypass -File " +
                    QuoteForArgument(scriptPath),
                appDir,
                logPath,
                12000);
        }
        catch (Exception ex)
        {
            Log(logPath, "process scan stop failed: " + ex.Message);
        }
    }

    private static void RunInstaller(string installerPath, string appDir, string logPath)
    {
        string arguments =
            "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR=" +
            QuoteForArgument(appDir);

        Log(logPath, "running installer");
        int exitCode = RunProcess(installerPath, arguments, appDir, logPath, 180000);

        if (exitCode != 0)
        {
            throw new InvalidOperationException("安装包退出码：" + exitCode);
        }

        Log(logPath, "installer finished");
    }

    private static void StartLauncher(string appDir, string logPath)
    {
        string launcherPath = Path.Combine(appDir, LauncherFileName());

        if (!File.Exists(launcherPath))
        {
            throw new FileNotFoundException("安装完成后找不到启动器", launcherPath);
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = launcherPath,
            WorkingDirectory = appDir,
            UseShellExecute = true,
        });

        Log(logPath, "launcher started");

        if (!WaitForServerReady(logPath, TimeSpan.FromSeconds(75)))
        {
            Log(logPath, "server was not confirmed ready after launcher start");
            MessageBox.Show(
                "安装包已运行完成，但没有确认后台服务成功启动。\n\n" +
                "请双击桌面“Jeff订单工具”重新打开；如果仍然打不开，请把 logs\\updater.log 和 logs\\server.log 发给开发人员。",
                AppTitle,
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
        }
    }

    private static bool WaitForServerReady(string logPath, TimeSpan timeout)
    {
        string healthUrl = "http://127.0.0.1:3000/api/health";
        DateTime deadline = DateTime.Now.Add(timeout);

        while (DateTime.Now < deadline)
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(healthUrl);
                request.Timeout = 1000;
                request.ReadWriteTimeout = 1000;

                using (var response = (HttpWebResponse)request.GetResponse())
                {
                    if ((int)response.StatusCode >= 200 &&
                        (int)response.StatusCode < 500)
                    {
                        using (var reader = new StreamReader(response.GetResponseStream()))
                        {
                            string body = reader.ReadToEnd();

                            if (body.Contains("jeff-order-tool"))
                            {
                                Log(logPath, "server ready after update");
                                return true;
                            }
                        }
                    }
                }
            }
            catch
            {
            }

            Thread.Sleep(1000);
        }

        return false;
    }

    private static int RunProcess(
        string fileName,
        string arguments,
        string workingDirectory,
        string logPath,
        int timeoutMilliseconds)
    {
        var info = new ProcessStartInfo
        {
            FileName = fileName,
            Arguments = arguments,
            WorkingDirectory = workingDirectory,
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
                throw new InvalidOperationException("无法启动进程：" + fileName);
            }

            if (!process.WaitForExit(timeoutMilliseconds))
            {
                try
                {
                    process.Kill();
                }
                catch
                {
                }

                throw new TimeoutException("进程执行超时：" + fileName);
            }

            string output = process.StandardOutput.ReadToEnd();
            string error = process.StandardError.ReadToEnd();

            if (output.Length > 0)
            {
                Log(logPath, output);
            }

            if (error.Length > 0)
            {
                Log(logPath, error);
            }

            return process.ExitCode;
        }
    }

    private static string LauncherFileName()
    {
        return new string(new[]
        {
            (char)0x6253, (char)0x5F00, (char)0x004A, (char)0x0065,
            (char)0x0066, (char)0x0066, (char)0x8BA2, (char)0x5355,
            (char)0x5DE5, (char)0x5177, (char)0x002E, (char)0x0065,
            (char)0x0078, (char)0x0065
        });
    }

    private static string QuoteForArgument(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    private static string QuoteForPowerShell(string value)
    {
        return "'" + value.Replace("'", "''") + "'";
    }

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch
        {
        }
    }

    private static void Log(string logPath, string message)
    {
        try
        {
            File.AppendAllText(
                logPath,
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message +
                Environment.NewLine);
        }
        catch
        {
        }
    }
}
