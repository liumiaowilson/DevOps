(function(cmd, context) {
    if(context.argv.length < 1) {
        cmd.error('File path is required');
        return;
    }

    const filePath = context.argv[0];
    const separator = ',';

    // `git status --short` wraps any path that contains a space or special
    // character in double quotes (with C-style backslash escapes inside).
    // Strip the wrapping quotes / unescape so the raw path is returned —
    // otherwise the quotes get double-wrapped downstream and break `eval`.
    const unquote = (p) => {
        p = p.trim();
        if(p.length >= 2 && p.startsWith('"') && p.endsWith('"')) {
            p = p.substring(1, p.length - 1).replace(/\\(["\\])/g, '$1');
        }
        return p;
    };

    return context.fs.readFile(filePath, 'utf8').then(content => {
        const result = content.split('\n').map(line => {
            if(!line.trim()) {
                return null;
            }
            // Short-status format: "XY path" or "XY path1 -> path2" (rename/copy).
            // X = staged state, Y = worktree state. Path always begins at index 3.
            const x = line.charAt(0);
            const y = line.charAt(1);
            const rest = line.substring(3);

            // Skip pure deletions — nothing to deploy.
            if(x === 'D' || y === 'D') {
                return null;
            }

            // Renames/copies (R*, C*) point old -> new; deploy the new path.
            if(x === 'R' || x === 'C') {
                const idx = rest.indexOf(' -> ');
                return unquote(idx >= 0 ? rest.substring(idx + 4) : rest);
            }

            // Modified, added, untracked, type-changed, etc. -> the path itself.
            if(x === 'M' || x === 'A' || x === 'T' || y === 'M' || y === 'A' || y === 'T' || x === '?') {
                return unquote(rest);
            }

            return null;
        }).filter(Boolean).join(separator);
        cmd.log(result);
        return result;
    });
})
