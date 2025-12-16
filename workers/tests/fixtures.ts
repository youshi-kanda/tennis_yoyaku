
export const HTML_MENU = `
<html>
<head><title>利用者メニュー</title></head>
<body>
    <div class="menu">
        <a href="rsvWTransInstListAction.do">施設の空き状況検索</a>
    </div>
</body>
</html>
`;

export const HTML_CALENDAR_OK = `
<html>
<body>
    <table>
        <tr>
            <!-- 2025-12-20, 09:00-11:00 (Code 10) -->
            <td id="20251220_10">
                <img src="img/icon_available.gif" alt="空き">
                <input type="hidden" name="selectBldCd" value="1234">
                <input type="hidden" name="selectInstCd" value="INST001">
            </td>
            <!-- 2025-12-20, 11:00-13:00 (Code 20) -->
            <td id="20251220_20">
                <img src="img/icon_full.gif" alt="満">
            </td>
        </tr>
    </table>
    <input type="hidden" name="selectPpsCd" value="PPS001">
    <input type="hidden" name="selectPpsClsCd" value="CLS001">
</body>
</html>
`;

export const HTML_RESERVATION_INPUT = `
<html>
<body>
    <form name="rsvWOpeReservedApplyForm" action="rsvWOpeReservedConfirmAction.do">
        <!-- Normal order -->
        <input type="hidden" name="instNo" value="INST_12345">
        
        <!-- Reversed order attribute -->
        <input value="DATE_67890" type="hidden" name="dateNo">
        
        <!-- Select with selected -->
        <select name="timeNo">
            <option value="TIME_001">09:00</option>
            <option value="TIME_002" selected>11:00</option>
            <option value="TIME_003">13:00</option>
        </select>

        <a href="rsvWOpeReservedConfirmAction.do?instNo=INST_12345&dateNo=DATE_67890&timeNo=TIME_002" id="confirmLink">確認</a>
    </form>
</body>
</html>
`;

export const HTML_CONFIRMATION = `
<html>
<body>
    <div class="confirm_box">
        受付内容確認
    </div>
    <form action="rsvWOpeReservedCompleteAction.do" method="post">
        <input type="button" value="予約する">
    </form>
</body>
</html>
`;

export const HTML_COMPLETE_SUCCESS = `
<html>
<body>
    <div class="complete_msg">
        予約を受け付けました。
        <br>
        予約番号 : 12345678
    </div>
</body>
</html>
`;

export const HTML_ERROR_SESSION = `
<html>
<body>
    <div class="error">
        セッションが切れました。もう一度ログインしてください。
    </div>
</body>
</html>
`;

export const HTML_ERROR_PARAM_MISSING = `
<html>
<body>
    <!-- Broken HTML with no links -->
    <div class="content">
        Invalid State
    </div>
</body>
</html>
`;
