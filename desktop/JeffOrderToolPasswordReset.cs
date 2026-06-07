using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class JeffOrderToolPasswordReset
{
    private const string AppTitle = "Jeff订单工具";

    [STAThread]
    private static void Main()
    {
        string baseDir = FindAppBaseDir(AppDomain.CurrentDomain.BaseDirectory);
        string dataDir = Path.Combine(baseDir, "data");
        string authPath = Path.Combine(dataDir, "admin-password.json");
        string tempPattern = "admin-password.json.*.tmp";
        string resetFlagPath = Path.Combine(dataDir, "reset-admin-password.flag");

        try
        {
            Directory.CreateDirectory(dataDir);

            if (File.Exists(authPath))
            {
                File.Delete(authPath);
            }

            foreach (string tempFile in Directory.GetFiles(dataDir, tempPattern))
            {
                TryDelete(tempFile);
            }

            File.WriteAllText(
                resetFlagPath,
                "reset requested at " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));

            StopJeffOrderServers(baseDir);

            MessageBox.Show(
                "密码已准备重置，后台服务也已关闭。\n\n请重新双击打开 Jeff订单工具，页面会要求重新设置管理员密码。\n\n订单数据不会被删除。",
                AppTitle,
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "重置密码失败：" + ex.Message,
                AppTitle,
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
        }
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

    private static string FindAppBaseDir(string currentDir)
    {
        if (Directory.Exists(Path.Combine(currentDir, "server")) &&
            Directory.Exists(Path.Combine(currentDir, "runtime")))
        {
            return currentDir;
        }

        DirectoryInfo parent = Directory.GetParent(
            currentDir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));

        if (parent != null &&
            Directory.Exists(Path.Combine(parent.FullName, "server")) &&
            Directory.Exists(Path.Combine(parent.FullName, "runtime")))
        {
            return parent.FullName;
        }

        return currentDir;
    }

    private static void StopJeffOrderServers(string baseDir)
    {
        string pidPath = Path.Combine(baseDir, "server.pid");

        if (File.Exists(pidPath))
        {
            string rawPid = File.ReadAllText(pidPath).Trim();
            int pid;

            if (int.TryParse(rawPid, out pid))
            {
                RunHidden("taskkill.exe", "/PID " + pid + " /T /F");
            }

            TryDelete(pidPath);
        }

        string script =
            "Get-CimInstance Win32_Process | Where-Object { " +
            "($_.Name -eq 'node.exe' -or $_.Name -eq 'cmd.exe') -and " +
            "$_.CommandLine -and " +
            "($_.CommandLine -like '*JeffOrderTool*' -or $_.CommandLine -like '*jeff-order-tool*' -or $_.CommandLine -like '*server.js*') " +
            "} | ForEach-Object { taskkill.exe /PID $_.ProcessId /T /F | Out-Null }";

        RunHidden(
            "powershell.exe",
            "-NoProfile -ExecutionPolicy Bypass -Command " + QuoteForCmd(script));
    }

    private static void RunHidden(string fileName, string arguments)
    {
        try
        {
            var info = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
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

    private static string QuoteForCmd(string value)
    {
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }
}
