(function(cmd, context) {
    const excludeList = context.argv;

    const logService = new context.LogService(context.connection);
    cmd.styledHeader('Logs will be written to ~/log');

    const homeDir = context.env.getString('CODE_BUILDER_HOME');
    return context.fs.writeFile(homeDir + '/log', '').then(() => {
        logService.tail(context.org, log => {
            for(const exclude of excludeList) {
                if(log.includes(exclude)) {
                    return;
                }
            }

            cmd.log(log);
            context.fs.appendFile(homeDir + '/log', log);
        });
    });
})
