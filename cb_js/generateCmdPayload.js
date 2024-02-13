(function(cmd, context) {
    const command = context.argv[0];
    if(!command) {
        cmd.error('Command Name is required');
        return;
    }

    const args = context.argv.slice(1);
    const payload = {
        command,
        args,
    };

    const result = JSON.stringify(payload);
    cmd.log(result);
    return result;
})
