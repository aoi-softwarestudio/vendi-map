import re

with open('data.js', 'r', encoding='utf-8') as f:
    content = f.read()

print("File size:", len(content))

# Extract first name
m = re.search(r'name: "([^"]+)"', content)
if m:
    print("First name:", m.group(1))

m2 = re.search(r'manufacturer: "([^"]+)"', content)
if m2:
    print("First mfg:", m2.group(1))

# Count entries
ids = re.findall(r'^\s+id: \d+,', content, re.MULTILINE)
print("Total entries:", len(ids))

# Find a Coca-Cola entry
idx = content.find('コカ・コーラ')
if idx >= 0:
    print("Found Coca-Cola at index:", idx)
    print(content[max(0,idx-100):idx+200])
