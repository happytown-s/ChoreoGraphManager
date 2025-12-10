from playwright.sync_api import sync_playwright

def verify_fix():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Listen for console logs
        page.on("console", lambda msg: print(f"Browser Console: {msg.text}"))

        page.goto("http://localhost:3000")
        page.wait_for_timeout(2000)

        print("--- STARTING RECORDING WITHOUT AUDIO ---")

        # 1. Start recording
        record_btn = page.locator('button[title="Export Video"]')
        if not record_btn.is_visible():
             # Fallback
             record_btn = page.locator('header button:has(svg.lucide-video)')

        record_btn.click()
        page.wait_for_timeout(1000)

        # 2. Collapse timeline
        collapse_btn = page.locator('button:has(svg.lucide-chevron-down)')
        if collapse_btn.is_visible():
             collapse_btn.click()

        page.wait_for_timeout(500)

        # 3. Check time advancement
        time_display = page.locator("text=/\\d+\\.\\d{2}s \\/ \\d+s/")

        try:
             initial_text = time_display.inner_text()
             print(f"Initial time: {initial_text}")

             page.wait_for_timeout(3000)

             new_text = time_display.inner_text()
             print(f"New time: {new_text}")

             initial_time_val = float(initial_text.split("s")[0])
             new_time_val = float(new_text.split("s")[0])

             print(f"Time diff: {new_time_val - initial_time_val}")

             if new_time_val > initial_time_val + 1.0:
                print("SUCCESS: Timeline is advancing.")
             else:
                print("FAILURE: Timeline is STUCK.")

        except Exception as e:
             print(f"Error checking time: {e}")
             page.screenshot(path="/home/jules/verification/verify_error.png")

        # Stop recording
        if record_btn.is_visible():
             record_btn.click()

        browser.close()

if __name__ == "__main__":
    verify_fix()
