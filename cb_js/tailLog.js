(function(cmd, context) {
    const excludeList = context.argv;

    const logService = new context.LogService(context.connection);
    cmd.styledHeader('Logs will be written to ~/log');

    return context.fs.writeFile('/home/codebuilder/log', '').then(() => {
        logService.tail(context.org, log => {
            for(const exclude of excludeList) {
                if(log.includes(exclude)) {
                    return;
                }
            }

            cmd.log(log);
            context.fs.appendFile('/home/codebuilder/log', log);
        });
    });
})
