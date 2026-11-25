# Lil Buddy — fish integration. install.sh drops a loader for this file into
# ~/.config/fish/conf.d/.
#
# The engine is a Node program; this function exists for one reason: when you
# press RUN in the scratchpad, the command must execute in THIS shell (your
# abbreviations, your cwd). The engine leaves the order in a handoff file and
# this function carries it out.

if not set -q LIL_HOME
    set -gx LIL_HOME (realpath (status dirname)/..)
end

function lil --description "Lil Buddy — pocket sysadmin"
    if not command -q node
        echo "lil: node is not on PATH — run $LIL_HOME/install.sh" >&2
        return 127
    end
    set -l handoff (command mktemp (set -q TMPDIR; and echo $TMPDIR; or echo /tmp)/lil-handoff.XXXXXX)
    or return 1
    LIL_HOME=$LIL_HOME LIL_SHELL=fish LIL_EDIT=1 LIL_HANDOFF=$handoff command node $LIL_HOME/src/cli.mjs $argv
    set -l rc $status
    if test -s $handoff
        set -l lines (command cat $handoff)
        command rm -f -- $handoff
        set -l action $lines[1]
        set -l cmd (string join \n -- $lines[2..-1])
        switch $action
            case run
                # `history append` arrived in fish 4; older fish just skips it.
                builtin history append -- $cmd 2>/dev/null
                eval $cmd
                return
            case edit
                commandline --replace -- $cmd 2>/dev/null
                and return 0
                # Older fish cannot pre-fill the prompt from a function: edit here.
                read --shell --command $cmd --prompt-str '❯ ' cmd
                and test -n "$cmd"
                and eval $cmd
                return
        end
    end
    command rm -f -- $handoff
    return $rc
end
