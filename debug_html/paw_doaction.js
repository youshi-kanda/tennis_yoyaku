
var	gOnExit = 1;

function doAction(form, action) {
	form.action = action;
	gOnExit = 0;
	form.submit();
	procStart();
}
