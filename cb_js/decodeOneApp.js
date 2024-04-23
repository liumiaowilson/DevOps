(function(cmd, context) {
    const url = context.argv[0];
    if(!url) {
        cmd.error('Please provide one app url with #');
        return;
    }

    const mark = url.split('#')[1];
    const payload = atob(decodeURIComponent(mark));

    cmd.log(JSON.stringify(JSON.parse(payload), null, 4));
})
