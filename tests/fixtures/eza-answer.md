`ls -A` — same as `-a` but skips `.` and `..`, so you get every real entry including dotfiles without the noise. Pair it with `-F` and `-l` and it's a proper directory listing: `ls -AFl`.

If you want a genuinely *sensible* listing (color, icons, file types, git status, tree view), graduate to `eza` — the maintained fork of exa. On your Homebrew setup:

```sh
eza -la --group-directories-first
```

Key flags vs plain ls: `-a` shows dotfiles, `--group-directories-first` sorts folders on top, `-T` gives you a tree. There's also `lsd` if you prefer a drop-in ls clone, but eza is the usual favorite. Remember: `-A` over `-a` is the zero-install win; eza is the power-up.

<lilcmd>
brew install eza && echo 'alias ls="eza -la --group-directories-first"' >> ~/.zshrc && source ~/.zshrc
</lilcmd>
