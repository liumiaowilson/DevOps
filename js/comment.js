const fs = require('fs');

const [,,RootDir, orgName, ...comment] = process.argv;

const commentsFile = `${RootDir}/.sfdx/comments.json`;
const json = JSON.parse(fs.readFileSync(commentsFile, 'utf8')) || {};

json[orgName] = comment.join(' ');

const content = JSON.stringify(json, null, 4);
fs.writeFileSync(commentsFile, content);
