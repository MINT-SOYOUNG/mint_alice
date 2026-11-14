/*
 * contact-mailto.js
 *
 * Vercel은 정적 호스팅이라 mail/contact_me.php 같은 PHP를 실행할 수 없습니다.
 * 그래서 문의 폼은 서버 없이, 입력한 내용을 기본 메일 앱(mailto)으로 넘깁니다.
 * 메일을 받을 주소를 바꾸려면 아래 MAIL_TO 값만 고치세요.
 */

$(function () {

    var MAIL_TO = "bluehanavi@gmail.com";

    $("#contactForm input, #contactForm textarea").jqBootstrapValidation({
        preventSubmit: true,
        submitError: function ($form, event, errors) {
            // 입력 오류는 각 필드 아래 help-block에 표시됩니다.
        },
        submitSuccess: function ($form, event) {
            event.preventDefault();

            var name = $.trim($("#name").val());
            var email = $.trim($("#email").val());
            var phone = $.trim($("#phone").val());
            var message = $.trim($("#message").val());

            var subject = "[포트폴리오 문의] " + name;
            var body = "이름: " + name + "\n"
                     + "이메일: " + email + "\n"
                     + "연락처: " + phone + "\n\n"
                     + message;

            var href = "mailto:" + MAIL_TO
                     + "?subject=" + encodeURIComponent(subject)
                     + "&body=" + encodeURIComponent(body);

            window.location.href = href;

            $("#btnSubmit").prop("disabled", false);
            $("#success").html(
                "<div class='alert alert-success'>" +
                "<button type='button' class='close' data-dismiss='alert' aria-hidden='true'>&times;</button>" +
                "<strong>메일 앱이 열립니다.</strong> 내용을 확인한 뒤 전송 버튼을 눌러 주세요." +
                "</div>"
            );

            $form.trigger("reset");
            $(".floating-label-form-group").removeClass("floating-label-form-group-with-value");
        },
        filter: function () {
            return $(this).is(":visible");
        }
    });

    // 메시지 입력을 시작하면 안내 문구를 지웁니다.
    $("#name").focus(function () {
        $("#success").html("");
    });
});
