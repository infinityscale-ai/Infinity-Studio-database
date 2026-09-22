// Shared between lib/db/ssh-tunnel.ts and main.js
function parseExtendedConnection(connectionString, normalizeFn) {
  const url = new URL(normalizeFn(connectionString));
  const sshMode = url.searchParams.get("infstudio_ssh_mode") === "ssh" ? "ssh" : "off";
  const sshConfig = {
    mode: sshMode,
    host: url.searchParams.get("infstudio_ssh_host") || "",
    port: Number(url.searchParams.get("infstudio_ssh_port") || "22") || 22,
    username: url.searchParams.get("infstudio_ssh_user") || "",
    authMode: url.searchParams.get("infstudio_ssh_auth") === "private-key" ? "private-key" : "password",
    password: url.searchParams.get("infstudio_ssh_password") || "",
    privateKey: url.searchParams.get("infstudio_ssh_private_key") || "",
  };
  const customKeys = [
    "infstudio_keychain_db",
    "infstudio_ssh_mode",
    "infstudio_ssh_host",
    "infstudio_ssh_port",
    "infstudio_ssh_user",
    "infstudio_ssh_auth",
    "infstudio_ssh_keychain",
    "infstudio_ssh_password",
    "infstudio_ssh_private_key",
  ];
  for (const key of customKeys) {
    url.searchParams.delete(key);
  }
  return {
    baseConnectionString: url.toString(),
    sshConfig,
  };
}

module.exports = { parseExtendedConnection };
