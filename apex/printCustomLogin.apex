String instanceUrl = URL.getOrgDomainUrl().toExternalForm();
String accessToken = UserInfo.getOrganizationId() + '' + UserInfo.getSessionId().subString(15);
String username = UserInfo.getUsername();
String cmd = 'sf mypim login custom -r ' + instanceUrl + ' -t \'' + accessToken + '\' -u ' + username + ' -a {{alias}}';
System.debug(cmd);
