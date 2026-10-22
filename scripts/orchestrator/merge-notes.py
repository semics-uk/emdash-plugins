"""Resolve rebase conflicts in a CONTEXT.md notes file: keep the branch's lines, then main's lines it doesn't repeat."""
import re
import sys

path = sys.argv[1]
text = open(path).read()


def keep_both(match):
    main_side = match.group(1).splitlines(True)
    branch_side = match.group(2)
    seen = set(branch_side.splitlines(True))
    return branch_side + "".join(line for line in main_side if line not in seen)


text = re.sub(r"<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n", keep_both, text, flags=re.S)
open(path, "w").write(text)
