const evaluate = async (script, ctx, cmd) => {
    const {
        username,
        q,
        FIRST,
        LAST,
        INPUT,
        VAR,
        DEBUG,
        CHOICE,
        PARENTS,
    } = ctx;

    return Promise.resolve(eval(script));
};

const buildProxyData = records => {
    const handler = {
        get(target, prop, receiver) {
            if(prop === 'records') {
                return records;
            }
            else {
                return records.map(record => getValue(record, prop));
            }
        },
    };

    return new Proxy({}, handler);
};

const printValue = value => {
    if(typeof value === 'string') {
        if(value.match(/^\d{4}-\d{2}-\d{2}$/)) {
            return value;
        }
        else if(value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:.*$/)) {
            return value;
        }
        else {
            return '\'' + value.replace(/'/g, '\\\'') + '\'';
        }
    }
    else if(Array.isArray(value)) {
        if(value.length) {
            return '(' + value.map(printValue).join(', ') + ')';
        }
        else {
            return `('${Date.now()}')`;
        }
    }
    else {
        return String(value);
    }
};

const queryAll = async (connection, query, cmd) => {
    if(query.startsWith('FIND')) {
        const result = await connection.search(query);
        return {
            records: result.searchRecords,
        };
    }
    else if(query.startsWith('~')) {
        query = query.substring(1);
        const result = await connection.tooling.query(query);

        while(!result.done) {
            const more = await connection.tooling.queryMore(result.nextRecordsUrl);
            result.records.push(...more.records);
            result.totalSize += more.totalSize;
            result.done = more.done;
            result.nextRecordsUrl = more.nextRecordsUrl;
        }

        return result;
    }
    else {
        const result = await connection.query(query);

        while(!result.done) {
            const more = await connection.queryMore(result.nextRecordsUrl);
            result.records.push(...more.records);
            result.totalSize += more.totalSize;
            result.done = more.done;
            result.nextRecordsUrl = more.nextRecordsUrl;
        }

        return result;
    }
};

const getValue = (record, field) => {
    return field.split('.').reduce((acc, part) => acc && acc[part], record);
};

(function(cmd, context) {
    const isDebug = context.env.getBoolean('DEBUG');
    const homeDir = context.env.getString('CODE_BUILDER_HOME');

    return context.fs.readFile(homeDir + '/.selected_query', 'utf8').then(content => {
        const lines = content.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));

        const datasets = [];
        const variables = {};
        let lastLine = null;

        const evaluateLine = async (line) => {
            const username = context.connection.username;
            const q = datasets;
            const FIRST = value => Array.isArray(value) ? value[0] : value;
            const LAST = value => Array.isArray(value) ? value[value.length - 1] : value;
            const INPUT = message => {
                return context.inquirer.prompt({
                    type: 'input',
                    name: 'value',
                    message,
                }).then(resp => resp.value);
            };
            const VAR = (name, value) => {
                if(typeof value === 'undefined') {
                    return variables[name];
                }
                else {
                    return Promise.resolve(value).then(value => {
                        variables[name] = value;
                        return value;
                    });
                }
            };
            const DEBUG = message => {
                if(isDebug) {
                    cmd.log(message);
                }
            };
            const CHOICE = (message, choices = []) => {
                return context.autocomplete({
                    message,
                    source: input => {
                        return choices.map(c => {
                            if(typeof c === 'string') {
                                return {
                                    value: c,
                                };
                            }
                            else {
                                return {
                                    value: c.value,
                                    description: c.description,
                                };
                            }
                        }).filter(o => !input || o.value.toLowerCase().includes(input.toLowerCase()) || o.description.toLowerCase().includes(input.toLowerCase()));
                    },
                });
            };
            const PARENTS = (proxyData, fieldName, value) => {
                const result = [];
                const records = proxyData.records;

                const recordMap = records.reduce((acc, record) => {
                    acc[record.Id] = record;
                    return acc;
                }, {});

                let record = recordMap[value];
                while(record) {
                    const parentId = getValue(record, fieldName);
                    if(parentId) {
                        result.push(parentId);
                    }

                    record = recordMap[parentId];
                }

                return result;
            };

            const ctx = {
                username,
                q,
                FIRST,
                LAST,
                INPUT,
                VAR,
                DEBUG,
                CHOICE,
                PARENTS,
            };

            if(line.startsWith(':')) {
                const script = line.substring(1).trim();
                return evaluate(script, ctx, cmd).then(() => null);
            }
            else {
                const p = /\${([^}]+?)}/g;
                let result = null;
                const scriptMap = {};
                while(result = p.exec(line)) {
                    const script = result[1];
                    scriptMap[script] = null;
                }

                return Promise.all(Object.keys(scriptMap).map(script => {
                    return evaluate(script, ctx, cmd).then(result => {
                        scriptMap[script] = result;
                    });
                })).then(() => {
                    line = line.replace(/:\${([^}]+?)}/g, (match, script) => printValue(scriptMap[script]));
                    line = line.replace(/\${([^}]+?)}/g, (match, script) => scriptMap[script]);
                    return line;
                });
            }
        };

        const queryLine = async (line) => {
            return queryAll(context.connection, line, cmd).then(data => {
                return buildProxyData(data.records);
            });
        };

        const queryLines = (lines, idx) => {
            const line = lines.shift();
            return evaluateLine(line).then(line => {
                let skipped = false;

                if(line) {
                    if(line.startsWith('?')) {
                        if(line.startsWith('?true ')) {
                            line = line.substring(6).trim();
                        }
                        else {
                            skipped = true;
                        }
                    }

                    if(isDebug) {
                        cmd.log(line);
                    }

                    if(!skipped) {
                        lastLine = line;
                    }
                }

                if(!lines.length) {
                    return context.fs.writeFile(homeDir + '/.selected_query', lastLine);
                }

                if(!line) {
                    return queryLines(lines, idx);
                }

                if(!skipped) {
                    return queryLine(line).then(result => {
                        datasets[idx] = result;

                        return queryLines(lines, idx + 1);
                    });
                }
                else {
                    datasets[idx] = buildProxyData([]);

                    return queryLines(lines, idx + 1);
                }
            });
        };

        return queryLines(lines, 0);
    });
})
