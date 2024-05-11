/*
 * This plugin is used to convert a flexcard with namespace omnistudio. To get started,
 * activate the flexcard and download the LWC zip file. Extract the zip file and run the plugin by
 * passing the js file path.
 */
(function(cmd, context) {
    const jsPath = context.argv[0];
    if(!jsPath) {
        cmd.error('Js Path is required');
        return;
    }

    const meta = `<?xml version="1.0" encoding="UTF-8"?>
<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>60.0</apiVersion>
    <isExposed>false</isExposed>
</LightningComponentBundle>`;

    context.ux.action.start('Converting FlexCard');
    const jsMetaPath = jsPath.replace('.js', '.js-meta.xml');
    const jsHtmlPath = jsPath.replace('.js', '.html');
    return Promise.all([
        context.fs.writeFile(jsMetaPath, meta),
        context.fs.readFile(jsHtmlPath, 'utf8').then(html => {
            html = html.replace(/omnistudio-/g, 'c-v-');
            html = html.replace(/c-cf-/g, 'c-');
            return context.fs.writeFile(jsHtmlPath, html);
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
