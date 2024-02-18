(function(vscode, context) {
    context.Logger.info('Hello from script');

    return vscode.window.showInformationMessage('Hello World');
})
