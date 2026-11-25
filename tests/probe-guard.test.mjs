// probe-guard.test.mjs — unit table for the read-only probe guard.
// Imports the REAL guard from pi/probe-guard.ts (Node type-stripping, 22.18+).
// Run: node tests/probe-guard.test.mjs
import { guardProbe, runProbe, PROBE_SHELL } from "../pi/probe-guard.ts";

const CASES = [
  // [command, expected, label]
  ["git --version", true, "ALLOW git --version"],
  ["lsof -nP -iTCP -sTCP:LISTEN", true, "ALLOW lsof listen"],
  ["ps aux | grep nginx 2>/dev/null", true, "ALLOW ps|grep w/ allowed redirect"],
  ["brew info eza", true, "ALLOW brew info"],
  ["man -k socket", true, "ALLOW man -k"],

  ["brew install eza", false, "BLOCK brew install"],
  ["git config user.name x", false, "BLOCK git config write"],
  ["rm -rf /tmp/x", false, "BLOCK rm not allowlisted"],
  ["echo hi > /tmp/f", false, "BLOCK redirection >"],
  ["python3 -c \"import os\"", false, "BLOCK interpreter -c"],
  ["sed -i '' s/a/b/ f", false, "BLOCK sed -i"],
  ["find . -exec rm {} \\;", false, "BLOCK find -exec"],
  ["true; brew install eza", false, "BLOCK true; brew install"],
  ["echo `whoami`", false, "BLOCK backtick"],

  // Extra coverage beyond the mandated 14.
  ["git config --get user.name", true, "ALLOW git config --get"],
  ["git config --list", true, "ALLOW git config --list"],
  ["brew --version", true, "ALLOW brew --version"],
  ["zsh --version", true, "ALLOW zsh --version"],
  ["npm view pi", true, "ALLOW npm view"],
  ["tmux display-message -p '#{session_name}'", true, "ALLOW tmux display-message"],
  ["ls | wc -l", true, "ALLOW ls | wc"],
  ["cat /etc/hosts | grep -v '^#' | head -5", true, "ALLOW cat|grep|head pipeline"],
  ["node --version", true, "ALLOW node --version"],
  ["python3 -V", true, "ALLOW python3 -V"],
  ["brew update", false, "BLOCK brew update (mutation)"],
  ["git push", false, "BLOCK git push"],
  ["git config --global user.name x", false, "BLOCK git config --global"],
  ["cat /etc/passwd > /tmp/out", false, "BLOCK cat redirection"],
  ["sudo ls", false, "BLOCK sudo"],
  ["echo $(date)", false, "BLOCK command substitution"],
  ["find . -delete", false, "BLOCK find -delete"],
  ["find . -ok rm {} \\;", false, "BLOCK find -ok"],
  ["awk '{system(\"ls\")}' f", false, "BLOCK awk system("],
  ["npm install lodash", false, "BLOCK npm install"],
  ["pip3 install requests", false, "BLOCK pip3 install"],
  ["launchctl load x.plist", false, "BLOCK launchctl load"],
  ["defaults write com.apple x y", false, "BLOCK defaults write"],
  ["bash -c 'rm -rf /tmp/x'", false, "BLOCK bash -c"],
  ["node -e 'process.exit()'", false, "BLOCK node -e"],
  ["xargs rm", false, "BLOCK xargs entirely"],

  // Linux inspection.
  ["systemctl status nginx", true, "ALLOW systemctl status"],
  ["systemctl --user list-units --type=service", true, "ALLOW systemctl list-units"],
  ["systemctl is-active sshd", true, "ALLOW systemctl is-active"],
  ["systemctl cat docker.service", true, "ALLOW systemctl cat"],
  ["journalctl -u nginx -n 50 --no-pager", true, "ALLOW journalctl read"],
  ["ss -ltnp", true, "ALLOW ss listeners"],
  ["ip -br addr show", true, "ALLOW ip addr show"],
  ["ip route get 1.1.1.1", true, "ALLOW ip route get"],
  ["dpkg -l | grep nginx", true, "ALLOW dpkg -l"],
  ["dpkg -S /usr/bin/ss", true, "ALLOW dpkg -S"],
  ["apt list --installed", true, "ALLOW apt list"],
  ["apt-cache policy nginx", true, "ALLOW apt-cache policy"],
  ["rpm -qa", true, "ALLOW rpm -qa"],
  ["dnf info nginx", true, "ALLOW dnf info"],
  ["pacman -Qi zsh", true, "ALLOW pacman -Qi"],
  ["pacman -Ss ripgrep", true, "ALLOW pacman -Ss"],
  ["lsblk -f", true, "ALLOW lsblk"],
  ["findmnt /", true, "ALLOW findmnt"],
  ["free -h", true, "ALLOW free"],
  ["cat /etc/os-release", true, "ALLOW os-release"],
  ["lsb_release -a", true, "ALLOW lsb_release"],
  ["hostnamectl", true, "ALLOW hostnamectl bare"],
  ["timedatectl status", true, "ALLOW timedatectl status"],
  ["resolvectl status", true, "ALLOW resolvectl status"],
  ["loginctl list-sessions", true, "ALLOW loginctl list-sessions"],
  ["command -v eza", true, "ALLOW command -v"],
  ["date -Iseconds", true, "ALLOW date -Iseconds"],
  ["date -u +%s", true, "ALLOW date format"],
  ["sed -n '5,10p' /etc/hosts", true, "ALLOW sed -n print"],
  ["sed -e 's/a/b/' /etc/hosts", true, "ALLOW sed -e"],
  ["sort -k2 -n /etc/passwd | uniq -c", true, "ALLOW sort|uniq"],
  ["awk -F: '{print $1}' /etc/passwd", true, "ALLOW awk -F"],
  ["git branch -a", true, "ALLOW git branch -a"],
  ["git branch --show-current", true, "ALLOW git branch --show-current"],
  ["git remote -v", true, "ALLOW git remote -v"],
  ["git tag -l 'v*'", true, "ALLOW git tag -l"],
  ["git stash list", true, "ALLOW git stash list"],
  ["env | grep PATH", true, "ALLOW bare env"],
  ["ls /nope >/dev/null 2>&1", true, "ALLOW >/dev/null 2>&1"],
  ["tail -n 20 /var/log/syslog", true, "ALLOW tail -n"],
  ["hostname -f", true, "ALLOW hostname -f"],
  ["sysctl -n kernel.ostype", true, "ALLOW sysctl read"],
  ["mount", true, "ALLOW bare mount"],

  ["systemctl restart nginx", false, "BLOCK systemctl restart"],
  ["systemctl --now enable nginx", false, "BLOCK systemctl enable"],
  ["systemctl daemon-reload", false, "BLOCK systemctl daemon-reload"],
  ["journalctl --vacuum-time=1d", false, "BLOCK journalctl vacuum"],
  ["journalctl -f", false, "BLOCK journalctl follow (hangs)"],
  ["ss -K dst 10.0.0.1", false, "BLOCK ss -K"],
  ["ip link set eth0 down", false, "BLOCK ip link set"],
  ["ip addr add 10.0.0.2/24 dev eth0", false, "BLOCK ip addr add"],
  ["ip netns exec x sh", false, "BLOCK ip netns exec"],
  ["dpkg -i pkg.deb", false, "BLOCK dpkg -i"],
  ["dpkg --purge nginx", false, "BLOCK dpkg --purge"],
  ["apt install eza", false, "BLOCK apt install"],
  ["apt-get install eza", false, "BLOCK apt-get (not allowlisted)"],
  ["rpm -e nginx", false, "BLOCK rpm -e"],
  ["dnf install nginx", false, "BLOCK dnf install"],
  ["pacman -S eza", false, "BLOCK pacman -S"],
  ["pacman -Syu", false, "BLOCK pacman -Syu"],
  ["pacman -Rns eza", false, "BLOCK pacman -R"],
  ["snap install hello", false, "BLOCK snap install"],
  ["flatpak install x", false, "BLOCK flatpak install"],
  ["hostnamectl set-hostname x", false, "BLOCK hostnamectl set-hostname"],
  ["timedatectl set-time 12:00", false, "BLOCK timedatectl set-time"],
  ["mount /dev/sdb1 /mnt", false, "BLOCK mount a device"],
  ["dmesg -C", false, "BLOCK dmesg -C"],
  ["sysctl -w vm.swappiness=10", false, "BLOCK sysctl -w"],
  ["sysctl vm.swappiness=10", false, "BLOCK sysctl name=value"],
  ["hostname newname", false, "BLOCK hostname set"],
  ["date -s '2020-01-01'", false, "BLOCK date -s"],
  ["date 010112002020", false, "BLOCK date set (BSD form)"],
  ["tail -f /var/log/syslog", false, "BLOCK tail -f (hangs)"],

  // Holes in the original guard, now closed.
  ["env rm -rf /tmp/x", false, "BLOCK env <command>"],
  ["ls & rm -rf /tmp/x", false, "BLOCK chaining with a lone &"],
  ["find . -execdir rm {} +", false, "BLOCK find -execdir"],
  ["find . -fprint /tmp/out", false, "BLOCK find -fprint"],
  ["sort -o /etc/hosts /etc/hosts", false, "BLOCK sort -o"],
  ["sort --compress-program=sh x", false, "BLOCK sort --compress-program"],
  ["uniq in.txt out.txt", false, "BLOCK uniq output file"],
  ["sed -n 'w /tmp/out' /etc/hosts", false, "BLOCK sed w"],
  ["sed 's/a/b/w /tmp/out' f", false, "BLOCK sed s///w"],
  ["sed --in-place s/a/b/ f", false, "BLOCK sed --in-place"],
  ["awk -f /tmp/script.awk x", false, "BLOCK awk -f"],
  ["git branch newbranch", false, "BLOCK git branch create"],
  ["git branch -D main", false, "BLOCK git branch -D"],
  ["git remote add origin x", false, "BLOCK git remote add"],
  ["git tag v1.0", false, "BLOCK git tag create"],
  ["git stash drop", false, "BLOCK git stash drop"],
  ["git log --output=/tmp/x", false, "BLOCK git --output"],
  ["man -P 'sh -c id' ls", false, "BLOCK man -P"],
  ["tmux display-message -p '#(touch /tmp/x)'", false, "BLOCK tmux #()"],
  ["command rm -rf /tmp/x", false, "BLOCK command <cmd>"],
  ["fish -c 'rm x'", false, "BLOCK fish -c"],
  ["file -C -m magic", false, "BLOCK file -C"],
];

let pass = 0;
const failures = [];
for (const [cmd, expected, label] of CASES) {
  const { allowed } = guardProbe(cmd);
  const ok = allowed === expected;
  if (ok) {
    pass++;
  } else {
    failures.push(`FAIL ${label} -> allowed=${allowed} expected=${expected}  (cmd: ${cmd})`);
  }
}

// Probes run under plain sh on every platform, never zsh.
if (PROBE_SHELL !== "/bin/sh") failures.push(`FAIL probe shell is ${PROBE_SHELL}`);
const echoed = await runProbe("echo vault111 | tr a-z A-Z");
if (echoed === "VAULT111") pass++; else failures.push(`FAIL runProbe pipeline -> ${JSON.stringify(echoed)}`);

for (const f of failures) console.log(f);
console.log(`${pass}/${CASES.length + 1} passed, ${failures.length} failed`);
process.exit(failures.length === 0 ? 0 : 1);
