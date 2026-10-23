# ExamTopics Navigator

## Summary
ExamTopics Navigator is a Chrome extension that helps you quickly move between ExamTopics questions and topics and jump to a specific exam code, topic, and question.

## Installation (Chrome / Firefox)
0. Download or clone this repository
1. Open Chrome and go to chrome://extensions
2. Enable Developer mode (top right corner toogle)
3. Click Load unpacked
4. Select this project folder: ExamTopicsExtension
5. Pin the extension (optional) so the popup is easy to access

For Firefox, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and select `manifest.json` in this folder. Temporary add-ons are removed when Firefox closes; install a signed package for persistent use.

To update after changes:
> In Chrome, go to `chrome://extensions` and click Reload on the extension card. In Firefox, use Reload in `about:debugging#/runtime/this-firefox`, then refresh any open ExamTopics tabs.

## Usage
### On ExamTopics pages
Open any https://www.examtopics.com page. A small on-page panel is available to navigate.

![main_page.png](screenshots/main_page.png)

You can enter Exam Code, Topic, and Question to jump directly. Use Hide to hide the panel and use the small Open button to show it again.

![open_circle.png](screenshots/open_circle.png)

### Using the extension popup
Click the extension icon to open the popup. Use Next and Previous to navigate. Use Go To to open an exact topic and question.

![discussion_page.png](screenshots/discussion_page.png)

## IMPORTANT
### OpenAI API key
Open the extension popup or the on-page panel, expand **Settings**, paste your OpenAI API key into **OpenAI API key**, and click **Save settings**.

![openai_settings.png](screenshots/openai_settings.png)

If navigation cannot find a page, Google may require a captcha. Solve it in the opened tab.

![captcha.png](screenshots/captcha.png)

Close opened search page.

![page_to_close.png](screenshots/page_to_close.png)

Try again whatever you clicked.

![retry.png](screenshots/retry.png)
