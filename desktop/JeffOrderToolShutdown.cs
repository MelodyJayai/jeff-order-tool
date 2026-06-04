using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class JeffOrderToolShutdown
{
    private const string AppTitle = "Jeff订单工具";

    [STAThread]
    private static void Main()
    {
        string baseDir = FindAppBaseDir(AppDomain.CurrentDomain.BaseDirectory);
        string pidPath = Path.Combine(baseDir, "server.pid");

        try
        {
            if (!File.Exists(pidPath))
            {
                MessageBox.Show(
                    "没有正在运行的后台服务。\n\n如果要打开工具，请返回上一层文件夹，双击“打开Jeff订单工具”。",
                    AppTitle,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
                return;
            }

            string rawPid = File.ReadAllText(pidPath).Trim();
            int pid;

            if (!int.TryParse(rawPid, out pid))
            {
                File.Delete(pidPath);
                MessageBox.Show(
                    "后台服务记录已失效，已清理。",
                    AppTitle,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
                return;
            }

            Process process = Process.GetProcessById(pid);
            bool isToolProcess =
                process.ProcessName.Equals("node", StringComparison.OrdinalIgnoreCase) ||
                process.ProcessName.Equals("cmd", StringComparison.OrdinalIgnoreCase);

            if (!isToolProcess)
            {
                File.Delete(pidPath);
                MessageBox.Show(
                    "后台服务记录已过期，未关闭其他程序。",
                    AppTitle,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
                return;
            }

            KillProcessTree(pid);
            File.Delete(pidPath);

            MessageBox.Show(
                "Jeff订单工具已关闭。",
                AppTitle,
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }
        catch (ArgumentException)
        {
            SafeDelete(pidPath);
            MessageBox.Show(
                "后台服务已经不在运行。\n\n如果要打开工具，请返回上一层文件夹，双击“打开Jeff订单工具”。",
                AppTitle,
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "关闭失败：" + ex.Message,
                AppTitle,
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
        }
    }

    private static void SafeDelete(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
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

    private static void KillProcessTree(int pid)
    {
        var info = new ProcessStartInfo
        {
            FileName = "taskkill.exe",
            Arguments = "/PID " + pid + " /T /F",
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };

        using (Process process = Process.Start(info))
        {
            if (process != null)
            {
                process.WaitForExit(5000);
            }
        }
    }
}
