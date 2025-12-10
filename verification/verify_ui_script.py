from playwright.sync_api import sync_playwright

def verify_changes():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the app (default Vite port)
        page.goto("http://localhost:3000")

        # Wait for the app to load
        page.wait_for_selector("text=ChoreoGraphManager")

        # 1. Verify Project Name Input exists and works
        project_input = page.get_by_placeholder("Project Name")
        if project_input.is_visible():
            print("Project Name input found")
            project_input.fill("My Cool Dance")
            # Verify value changed
            # expect(page.get_by_placeholder("Project Name")).to_have_value("My Cool Dance")
            # But just checking JS value for simplicity in this script
            val = project_input.input_value()
            if val == "My Cool Dance":
                print("Project Name input works")
            else:
                print(f"Project Name input update failed, got {val}")
        else:
            print("Project Name input not found")

        # 2. Verify Audio UI (should show 'Add Music' initially)
        # Note: We can't easily upload a file in headless easily without a file,
        # but we can check the initial state which is "Add Music" text + Icon (based on code)
        # Wait, the code says:
        # {audioFileName ? (text) : (<><Icon/> <span>Add Music</span></>)}

        # So we look for "Add Music"
        add_music = page.get_by_text("Add Music", exact=False)
        if add_music.is_visible():
            print("'Add Music' text found")
        else:
            print("'Add Music' text not found")

        # Take screenshot
        page.screenshot(path="verification/verification.png")
        print("Screenshot saved to verification/verification.png")

        browser.close()

if __name__ == "__main__":
    verify_changes()
