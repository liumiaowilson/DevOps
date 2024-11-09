(function(cmd, context) {
    const input = context.argv.join(' ');

    context.ux.action.start('Asking questions');
    return context.mypim.apex.post('/modelApi/generate', {
        prompt: input,
        modelName: 'sfdc_ai__DefaultGPT4Omni'
    }).then(result => {
        cmd.log(result);
    });
})
