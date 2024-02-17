(function(cmd, context) {
    const path = context.argv[0];
    if(!path) {
        cmd.error('Script Path is required');
        return;
    }

    if(!path.startsWith('/')) {
        cmd.error('Absoluate Path is required');
        return;
    }

    const payload = {
        command: 'multiclip.runScript',
        args: [ path ],
    };

    return context.executeRemoteCommand(payload).then(result => {
        if(result.success) {
            cmd.log(result.result);
        }
        else {
            cmd.error(result.message);
        }
    });
})
