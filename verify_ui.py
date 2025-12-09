from playwright.sync_api import sync_playwright

def verify_ui_elements():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("http://localhost:3000")
        page.wait_for_timeout(2000)

        # Check for Save and Load buttons
        print("Checking for Save/Load buttons...")
        save_btn = page.locator('button[title="Save Project"]')
        load_btn = page.locator('button[title="Load Project"]')

        if save_btn.is_visible() and load_btn.is_visible():
            print("SUCCESS: Save and Load buttons are visible.")
        else:
            print("FAILURE: Save and Load buttons are NOT visible.")

        # Check for Audio Filename display placeholder (should be "Add Music" initially)
        print("Checking for Audio Filename display...")
        # In Timeline.tsx: {audioFileName || "Add Music"}
        audio_label = page.get_by_text("Add Music")
        if audio_label.is_visible():
             print("SUCCESS: 'Add Music' label is visible.")
        else:
             print("FAILURE: 'Add Music' label not found.")

        page.screenshot(path="/home/jules/verification/ui_verification.png")
        browser.close()

if __name__ == "__main__":
    verify_ui_elements()
