const fs = require('fs');
const { exec } = require('child_process');

const [,,RootDir] = process.argv;

exec('sfdx force:org:display', (error, stdout, stderr) => {
    if(error) {
        console.log(error.message);
    }
    if(stderr) {
        console.log(stderr);
    }
    const lines = stdout.split('\n');
    const [,username] = lines.find(line => line.startsWith('Username')).split(/\s+/);
    const sourcePathInfosFile = `${RootDir}/.sfdx/orgs/${username}/sourcePathInfos.json`;
    const json2 = JSON.parse(fs.readFileSync(sourcePathInfosFile, 'utf8'));
    fs.unlinkSync(sourcePathInfosFile);

    exec('sfdx force:source:status', (error, stdout, stderr) => {
        if(error) {
            console.log(error.message);
        }
        if(stderr) {
            console.log(stderr);
        }
        const json1 = JSON.parse(fs.readFileSync(sourcePathInfosFile, 'utf8'));
        const json = {};

        Object.keys(json1).forEach(key => {
            if(json2[key]) {
                json[key] = json2[key];
            }
            else {
                json[key] = json1[key];
            }
        });

        const content = JSON.stringify(json, null, 4);
        fs.writeFileSync(sourcePathInfosFile, content);
    });
});
