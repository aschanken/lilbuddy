# Finding what owns a port

Short answer: **ss** on Linux, `lsof` on macOS. Both show the *listening* socket and the PID that holds it.

## The options
- `ss -ltnp` lists TCP listeners with process names; needs root to see other users' processes.
- `lsof -nP -iTCP:8080 -sTCP:LISTEN` works on both platforms and is the most portable choice you have.
* `netstat -tulpn` is the legacy tool, deprecated in favour of **iproute2** on every modern distro.

### Steps
1. Run the command below.
2. Read the **PID/Program name** column — that is your culprit, and `ps -fp <pid>` tells you who started it.
10. Kill it politely with `kill <pid>` before reaching for `-9`.

#### Not a header (four hashes)
Globs like *.txt and a lone * stay literal, as does an unmatched ** marker or a stray ` backtick.
A line with `code that has spaces inside it and should never be split across a wrap point` right here.
Averyveryverylongwordthatcannotbewrappedatanywordboundarybecausethereisnospaceinitanywhereatallforareallylongtime ok.
