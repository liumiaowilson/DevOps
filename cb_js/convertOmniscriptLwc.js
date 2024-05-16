/*
 * This plugin is used to convert an omniscript with namespace omnistudio. To get started,
 * activate the omniscript and download the LWC zip file. Extract the zip file and run the plugin by
 * passing the js file path.
 */
(function(cmd, context) {
    const jsPath = context.argv[0];
    if(!jsPath) {
        cmd.error('Js Path is required');
        return;
    }

    context.ux.action.start('Converting Omniscript');
    const jsMetaPath = jsPath.replace('.js', '.js-meta.xml');
    const jsHtmlPath = jsPath.replace('.js', '.html');
    const jsNdsHtmlPath = jsPath.replace('.js', '_nds.html');
    return Promise.all([
        context.fs.readFile(jsMetaPath, 'utf8').then(meta => {
            meta = meta.replace('<runtimeNamespace>omnistudio</runtimeNamespace>', '');
            return context.fs.writeFile(jsMetaPath, meta);
        }),
        context.fs.readFile(jsHtmlPath, 'utf8').then(html => {
            html = html.replace(/omnistudio-/g, 'c-v-');
            html = html.replace(/c-cf-/g, 'c-');
            html = html.replace(/Parent\./g, '');
            return context.fs.writeFile(jsHtmlPath, html);
        }),
        context.fs.readFile(jsNdsHtmlPath, 'utf8').then(html => {
            html = html.replace(/omnistudio-/g, 'c-v-');
            html = html.replace(/c-cf-/g, 'c-');
            html = html.replace(/Parent\./g, '');
            return context.fs.writeFile(jsNdsHtmlPath, html);
        }),
        context.fs.readFile(jsPath, 'utf8').then(js => {
            js = js.replace(/omnistudio\/[a-zA-Z0-9]+/g, (m) => {
                m = m.substring("omnistudio".length + 1);
                return "c/v" + m[0].toUpperCase() + m.substring(1);
            });
            return context.fs.writeFile(jsPath, js);
        }),
    ]).finally(() => {
        context.ux.action.stop();
    });
})
