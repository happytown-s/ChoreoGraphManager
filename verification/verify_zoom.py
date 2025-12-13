from playwright.sync_api import sync_playwright

def verify_timeline_zoom():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            page.goto("http://localhost:3000")
            page.wait_for_selector(".keyframe-marker", timeout=10000)

            labels = page.locator("div.flex.justify-between.mt-1 span")
            if labels.count() >= 3:
                print(f"Initial: {labels.nth(0).inner_text()} - {labels.nth(2).inner_text()}")

            zoom_in = page.locator('button[title="Zoom In (Ctrl+Wheel)"]')
            if zoom_in.count() > 0:
                print("Zoom In button FOUND.")
                zoom_in.click()
                zoom_in.click()
                zoom_in.click()
                page.wait_for_timeout(1000)
                page.screenshot(path="verification/zoom_success.png")

                if labels.count() >= 3:
                     print(f"After Zoom: {labels.nth(0).inner_text()} - {labels.nth(2).inner_text()}")
            else:
                print("Zoom In button NOT FOUND.")
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_timeline_zoom()
