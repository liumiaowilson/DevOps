(function(cmd, context) {
    const path = context.argv[0];
    if(!path) {
        cmd.error('File Path is required');
        return;
    }

    const exec = new context.ExecuteService(context.connection);
    const code = exec.readApexFile(path);
    if(!code) {
        cmd.error('Empty code');
        return;
    }

    const lines = code.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    if(!lastLine.startsWith('return ')) {
        cmd.error('Code should return something');
        return;
    }

    const logFileName = 'log-' + Date.now() + '.json';
    lines[lines.length - 1] = 'Object result = ' + lastLine.substring(7);

    const finalLines = [
        ...lines,
        `insert new ContentVersion(Title = '${logFileName}', PathOnClient = '${logFileName}', VersionData = Blob.valueOf(JSON.serialize(result)));`,
    ];

    const options = {
        apexCode: finalLines.join('\n'),
    };

    return exec.executeAnonymous(options).then(result => {
        if(result.success) {
            const lines = result.logs.split('\n').filter(line => line.includes('|USER_DEBUG|'));
            for(const line of lines) {
                cmd.log(line);
            }

            return context.connection.query(`SELECT Id, ContentDocumentId FROM ContentVersion WHERE Title = '${logFileName}' AND IsLatest = true`).then(data => {
                if(!data.records.length) {
                    return;
                }

                const cvId = data.records[0].Id;
                const cdId = data.records[0].ContentDocumentId;

                return context.connection.request(`/sobjects/ContentVersion/${cvId}/VersionData`).then(data => {
                    cmd.log(JSON.parse(data));
                }).then(() => {
                    return context.connection.sobject('ContentDocument').delete(cdId);
                });
            });
        }
        else {
            for(const diagnosticLine of result.diagnostic) {
                if(result.compiled) {
                    cmd.error(`Line: ${diagnosticLine.lineNumber}, Column: ${diagnosticLine.columnNumber}, Error: ${diagnosticLine.exceptionMessage}`);
                    cmd.error(diagnosticLine.exceptionStackTrace);
                }
                else {
                    cmd.error(`Line: ${diagnosticLine.lineNumber}, Column: ${diagnosticLine.columnNumber}, Error: ${diagnosticLine.compileProblem}`);
                }
            }
        }
    });
})
