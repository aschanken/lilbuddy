Use a drop-in unit instead of editing the vendor file:

```ini
[Service]
Environment=PORT=8080
    ExecStart=/usr/local/bin/app --port ${PORT} --log-level debug --config /etc/app/config.toml --pid-file /run/app/app.pid
```

Then reload. Remember: a clean `$PATH` is a happy `$PATH`!

```sh
systemctl cat app.service
```
⚠ This one bites — read twice.

```lilcmd
sudo systemctl daemon-reload && sudo systemctl restart app.service
```
