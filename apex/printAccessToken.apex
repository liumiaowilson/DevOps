String instanceUrl = URL.getOrgDomainUrl().toExternalForm();
String accessToken = UserInfo.getOrganizationId() + '' + UserInfo.getSessionId().subString(15);
System.debug(accessToken);
