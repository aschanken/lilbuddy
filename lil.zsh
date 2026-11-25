# lil.zsh — kept at the repo root so installs made by the original
# install.zsh (`source <repo>/lil.zsh`) keep working after a `git pull`.
# The real integration lives in shell/lil.zsh.
source "${${(%):-%x}:A:h}/shell/lil.zsh"
