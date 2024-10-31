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

const evaluate = async (script, ctx) => {
    const {
        username,
        q,
        FIRST,
        LAST,
        INPUT,
    } = ctx;

    return Promise.resolve(eval(script)).then(printValue);
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
    const homeDir = context.env.getString('CODE_BUILDER_HOME');

    context.ux.action.start('Evaluating query...');
    return context.fs.readFile(homeDir + '/.selected_query', 'utf8').then(content => {
        const lines = content.split('\n').map(line => line.trim()).filter(Boolean);

        const datasets = [];

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

            const ctx = {
                username,
                q,
                FIRST,
                LAST,
                INPUT,
            };
            
            const p = /:\${([^}]+)}/g;
            let result = null;
            const scriptMap = {};
            while(result = p.exec(line)) {
                const script = result[1];
                scriptMap[script] = null;
            }

            return Promise.all(Object.keys(scriptMap).map(script => {
                return evaluate(script, ctx).then(result => {
                    scriptMap[script] = result;
                });
            })).then(() => {
                line = line.replace(/:\${([^}]+)}/g, (match, script) => scriptMap[script]);
                return line;
            });
        };

        const queryLine = async (line) => {
            return queryAll(context.connection, line, cmd).then(data => {
                return buildProxyData(data.records);
            });
        };

        const queryLines = (lines, idx) => {
            const line = lines.shift();
            return evaluateLine(line).then(line => {
                if(lines.length) {
                    return queryLine(line).then(result => {
                        datasets[idx] = result;

                        return queryLines(lines, idx + 1);
                    });
                }
                else {
                    return context.fs.writeFile(homeDir + '/.selected_query', line);
                }
            });
        };

        return queryLines(lines, 0);
    }).finally(() => {
        context.ux.action.stop();
    });
})
