/* sample callback script
(function(json, context) {
    return json;
})
*/

const iterate = (json, fn, context, cmd, cmpName) => {
    if(json == null) return;
    if(typeof json === 'object' && json.constructor === Object) {
        const newJson = fn(json, context, cmd, cmpName);
        if(!newJson) {
            throw new Error('Invalid return for callback fn');
        }

        Object.keys(newJson).forEach(key => {
            newJson[key] = iterate(newJson[key], fn, context, cmd, cmpName);
        });

        return newJson;
    }
    else if(Array.isArray(json)) {
        return json.map(item => iterate(item, fn, context, cmd, cmpName));
    }
    else {
        return json;
    }
};

const callbacks = {
    onInit: null,
    onComplete: null,
};

(function(cmd, context) {
    const path = context.argv[0];
    if(!path) {
        cmd.error('Callback script path is required');
        return;
    }

    const homeDir = context.env.getString('CODE_BUILDER_HOME');

    context.ux.action.start('Processing components');
    return context.fs.readFile(path, 'utf8').then(callbackContent => {
        const callbackFn = eval(callbackContent);
        const rootDir = homeDir + '/practifi/data/texei/components';
        return context.fs.readdir(rootDir).then(dirs => {
            const cmpTypes = [];
            for(const dir of dirs) {
                if(!dir.endsWith('.js')) {
                    cmpTypes.push(dir);
                }
            }

            return Promise.all(cmpTypes.map(cmpType => {
                const cmpRootDir = rootDir + '/' + cmpType;
                return context.fs.readdir(cmpRootDir).then(filenames => {
                    return filenames.filter(filename => filename.endsWith('.meta.json')).map(filename => {
                        const name = filename.substring(0, filename.length - 10);
                        return {
                            type: cmpType,
                            folder: cmpRootDir,
                            cmpFileName: name + '.json',
                            metaFileName: name + '.meta.json',
                        };
                    });
                });
            })).then(dataList => {
                const data = dataList.flat();
                return Promise.all(data.map(item => {
                    return context.fs.readFile(item.folder + '/' + item.cmpFileName, 'utf8').then(cmpJSON => {
                        const cmp = JSON.parse(cmpJSON);
                        const newCmp = iterate(cmp, callbackFn, {
                            ...context,
                            registerCallbacks: cbs => {
                                callbacks.onInit = cbs?.onInit;
                                callbacks.onComplete = cbs?.onComplete;
                            },
                        }, cmd, item.cmpFileName);
                        if(!newCmp) {
                            cmd.log('Invalid newCmp for ' + item.cmpFileName);
                        }

                        const oldText = JSON.stringify(JSON.parse(cmpJSON));
                        const newText = JSON.stringify(newCmp);
                        if(oldText != newText) {
                            cmd.styledHeader('Processed ' + item.type + ': ' + item.cmpFileName);
                            return context.fs.writeFile(item.folder + '/' + item.cmpFileName, JSON.stringify(newCmp, null, 4));
                        }
                    }).catch(error => cmd.log(error.message));
                }));
            });
        });
    }).finally(() => {
        if(callbacks.onComplete) {
            callbacks.onComplete(cmd, context);
        }

        context.ux.action.stop();
    });
})
