
function submitLogin(obj, action, event) {

	replaceStr = new Array();
	var i = 0;

	if (obj.userId.value == "") {
		showAlert(obj.e410000.value);
		obj.userId.focus();
		return;
	}

	if (obj.password.value == "") {
		showAlert(obj.e410010.value);
		obj.password.focus();
		return;
	}

	if (chkHanNum(obj.userId.value) == false) {
		showAlert(obj.e410320.value);
		resetUserID(obj);
		obj.userId.focus();
		return;
	}


	if ( 1 != userpwchkoff) {
		if ( 1 == usersetpass ) {
			if (obj.password.value.length < userpassmin) {
				replaceStr[0] = userpassmin;
				showAlert(replaceErrMsg(obj.e520760.value,replaceStr));
				obj.password.focus();
				return;
			}
			if (obj.password.value.length > userpassmax) {
				replaceStr[0] = userpassmax;
				showAlert(replaceErrMsg(obj.e520770.value,replaceStr));
				obj.password.focus();
				return;
			}
			if(!checkText(obj.password, userpassmax, obj.e520790.value, 5)) {
				obj.password.focus();
				return;
			}
		} else
		if ( 2 == usersetpass ) {

			if (obj.password.value.length < userpassmin) {
				replaceStr[0] = userpassmin;
				showAlert(replaceErrMsg(obj.e520760.value,replaceStr));
				obj.password.focus();
				return;
			}
			if (obj.password.value.length > userpassmax) {
				replaceStr[0] = userpassmax;
				showAlert(replaceErrMsg(obj.e520770.value,replaceStr));
				obj.password.focus();
				return;
			}

			if(!checkText(obj.password, userpassmax, obj.e520800.value, 4)) {
				obj.password.focus();
				return;
			}

			str = obj.password.value;
			if ( str.match(/.*[0-9].*/) && str.match(/.*[a-zA-Z].*/) ) {
				;
			} else {
			showAlert(obj.e520780.value);
				obj.password.focus();
				return;
			}
		}
		if ( 3 == usersetpass ) {
			if (obj.password.value.length < userpassmin) {
				replaceStr[0] = userpassmin;
				showAlert(replaceErrMsg(obj.e520760.value,replaceStr));
				obj.password.focus();
				return;
			}
			if (obj.password.value.length > userpassmax) {
				replaceStr[0] = userpassmax;
				showAlert(replaceErrMsg(obj.e520770.value,replaceStr));
				obj.password.focus();
				return;
			}

			if(!checkText(obj.password, userpassmax, obj.e520800.value, 4)) {
				obj.password.focus();
				return;
			}
		}
	}
	var $pawab2100 = $("#wrapper").find("form");

	for ( i = 0 ; i < obj.password.value.length ; i++ ) {
		$pawab2100
			.append("<input>")
			.find("input")
			.last()
			.attr({"type":"hidden","name":"loginCharPass","value":obj.password.value.charAt(i)});
	}
	if( gRecaptchaActive ) {
		try {
			event.preventDefault(); 
			grecaptcha.ready(function() {
				grecaptcha.execute(gRecaptchaSiteKey, {action: gRecaptchaActionName})
				.then(function(token) {
					var recaptchaToken = document.getElementById('recaptchaToken');
					recaptchaToken.value = token;
					doAction(obj, action);
				});
			});
		}catch(err){
			var recaptchaToken = document.getElementById('recaptchaToken');
			recaptchaToken.value = gRecaptchaErrMsg;
			doAction(obj, action);
		}
	}
	else {
	doAction(obj, action)
	}
}

$(function(){
	$('[data-toggle="tooltip"]').tooltip();
	$("[data-toggle=popover]").popover();
});

