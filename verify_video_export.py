from playwright.sync_api import sync_playwright

def verify_timeline_and_video_export():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("http://localhost:3000")

        # Wait for app to load
        page.wait_for_timeout(2000)

        # 1. Verify timeline exists (using a better selector)
        # The timeline component has "Timeline" or something specific?
        # Let's verify the Record button exists.

        # 2. Start recording
        print("Clicking record button...")
        record_btn = page.locator('button[title="Export Video"]')
        if not record_btn.is_visible():
             print("Record button not found!")
             # Try finding by icon if title fails (it shouldn't)
        record_btn.click()

        # Wait for recording to start
        page.wait_for_timeout(1000)

        # 3. Collapse timeline to see time display
        # The chevron button toggles the timeline height.
        print("Collapsing timeline to see time display...")
        # Finding the button that contains a ChevronDown (lucide-chevron-down)
        # The SVG has class lucide-chevron-down
        collapse_btn = page.locator('button:has(svg.lucide-chevron-down)')
        if collapse_btn.is_visible():
             collapse_btn.click()
        else:
             print("Collapse button not visible/found")
             # It might be up if already collapsed (unlikely as default is open)

        page.wait_for_timeout(500)

        # 4. Check time advancement
        # Find element containing text like "s / "
        time_display = page.locator("text=/\\d+\\.\\d{2}s \\/ \\d+s/")

        try:
             initial_text = time_display.inner_text()
             print(f"Initial time: {initial_text}")

             page.wait_for_timeout(2000)

             new_text = time_display.inner_text()
             print(f"New time: {new_text}")

             if initial_text != new_text:
                print("SUCCESS: Timeline is advancing!")
             else:
                print("FAILURE: Timeline is NOT advancing!")
        except Exception as e:
             print(f"Could not read time display: {e}")
             # Take a screenshot to debug
             page.screenshot(path="/home/jules/verification/debug_time.png")

        # Take final screenshot
        page.screenshot(path="/home/jules/verification/verification.png")

        # Stop recording (optional, just cleanup)
        if record_btn.is_visible():
             record_btn.click()

        browser.close()

if __name__ == "__main__":
    verify_timeline_and_video_export()
