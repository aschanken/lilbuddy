-- Lil Buddy integration for WezTerm (optional).
--
-- Paste these entries into the `keys` table of your wezterm.lua config.
-- Prerequisite inside tmux: `set -g allow-passthrough on` (add to ~/.tmux.conf
-- and `tmux source-file ~/.tmux.conf`). Without it the user-var OSC cannot
-- cross tmux and the plain keys (Ctrl+R / Ctrl+Y) still work.
--
-- While the Lil Buddy scratchpad is open (user-var LIL_SCRATCHPAD=1):
--   CMD+Enter -> SendString("\x12")  i.e. Ctrl+R = RUN the scratchpad command
--   CMD+c     -> SendString("\x19")  i.e. Ctrl+Y = COPY the command
-- Otherwise they fall back to the usual actions (fullscreen / clipboard copy).
--
-- Linux: CMD is the Super key, which most desktops keep for themselves. Swap
-- `mods = 'CMD'` for `mods = 'CTRL|SHIFT'` in both entries (and drop the
-- fallback actions you don't use) — or skip this file entirely: Ctrl+R and
-- Ctrl+Y work in every terminal.

{
  key = 'Enter',
  mods = 'CMD',
  action = wezterm.action_callback(function(win, pane)
    if pane:get_user_vars().LIL_SCRATCHPAD == '1' then
      pane:send_text('\x12')
    else
      win:perform_action(wezterm.action.ToggleFullScreen, pane)
    end
  end),
},
{
  key = 'c',
  mods = 'CMD',
  action = wezterm.action_callback(function(win, pane)
    if pane:get_user_vars().LIL_SCRATCHPAD == '1' then
      pane:send_text('\x19')
    else
      win:perform_action(wezterm.action.CopyTo('Clipboard'), pane)
    end
  end),
},
