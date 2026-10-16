import { describe, expect, test } from "bun:test";
import {
  emailDocument,
  hasRemoteContent,
  replySubject,
  textAsHtml,
} from "./email-html";

describe("email html", () => {
  test("remote images are refused by the page's own policy until asked for", () => {
    expect(emailDocument("<p>x</p>", { remote: false, dark: false })).toContain(
      "img-src data: cid:;",
    );
    expect(emailDocument("<p>x</p>", { remote: true, dark: true })).toContain(
      "img-src * data: cid:;",
    );
  });

  test("detects remote images and backgrounds", () => {
    expect(hasRemoteContent('<img src="https://t.co/p.gif">')).toBe(true);
    expect(hasRemoteContent('<td style="background:url(http://x/y)">')).toBe(
      true,
    );
    expect(hasRemoteContent('<img src="cid:logo">')).toBe(false);
  });

  test("text is escaped and reply subjects do not stack", () => {
    expect(textAsHtml("<b>&")).toContain("&lt;b&gt;&amp;");
    expect(replySubject("Re: Lunch")).toBe("Re: Lunch");
    expect(replySubject("Lunch")).toBe("Re: Lunch");
  });
});
