using System;
using System.Diagnostics;
using System.IO;
using System.Net;
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

    [STAThread]
    private static void Main()
    {
        string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        string url = "http://127.0.0.1:" + Port;

        try
        {
            if (!IsReady(url))
            {
                ServerStart server = StartServer(baseDir);

                if (!WaitUntilReady(url, TimeSpan.FromSeconds(60), server.Process))
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
            Quote(nodeExe) + " " + Quote(serverJs) +
            " >> " + Quote(logPath) + " 2>&1";

        var info = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = "/d /s /c " + Quote(command),
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

        Process process = Process.Start(info);

        if (process == null)
        {
            throw new InvalidOperationException("无法启动后台服务");
        }

        File.WriteAllText(Path.Combine(baseDir, "server.pid"), process.Id.ToString());
        return new ServerStart { Process = process, LogPath = logPath };
    }

    private static bool WaitUntilReady(string url, TimeSpan timeout, Process process)
    {
        DateTime deadline = DateTime.Now.Add(timeout);

        while (DateTime.Now < deadline)
        {
            if (process.HasExited)
            {
                return false;
            }

            if (IsReady(url))
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

    private static bool IsReady(string url)
    {
        try
        {
            var request = (HttpWebRequest)WebRequest.Create(url);
            request.Timeout = 1000;
            request.ReadWriteTimeout = 1000;

            using (var response = (HttpWebResponse)request.GetResponse())
            {
                if ((int)response.StatusCode < 200 || (int)response.StatusCode >= 500)
                {
                    return false;
                }

                using (var reader = new StreamReader(response.GetResponseStream()))
                {
                    return reader.ReadToEnd().Contains("jeff-order-tool");
                }
            }
        }
        catch
        {
            return false;
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

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }
}
