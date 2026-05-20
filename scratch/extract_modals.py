import os

file_path = "c:/projects/OmniBase/frontend/src/Home.jsx"
with open(file_path, "r", encoding="utf-8") as f:
    lines = f.readlines()

# Find function ChannelCreationWizard
start_idx = -1
end_idx = -1
for i, line in enumerate(lines):
    if "function ChannelCreationWizard" in line:
        start_idx = i
        break

for i, line in enumerate(lines):
    if "function Home" in line:
        end_idx = i
        break

if start_idx != -1 and end_idx != -1:
    modals_code = lines[start_idx:end_idx]
    
    # Create Modals file
    modals_path = "c:/projects/OmniBase/frontend/src/components/modals/ChannelModals.jsx"
    with open(modals_path, "w", encoding="utf-8") as f:
        f.write("import React, { useState, useEffect } from 'react';\n")
        f.write("import { useParams } from 'react-router-dom';\n")
        f.write("import api from '../../api';\n\n")
        
        # Add export to the functions
        for line in modals_code:
            if line.startswith("function ChannelCreationWizard"):
                f.write(line.replace("function", "export function"))
            elif line.startswith("function PrivateChannelMembersModal"):
                f.write(line.replace("function", "export function"))
            else:
                f.write(line)
                
    # Modify Home.jsx
    new_home_lines = lines[:start_idx] + lines[end_idx:]
    
    # Add imports to Home.jsx
    imports = "import { ChannelCreationWizard, PrivateChannelMembersModal } from './components/modals/ChannelModals';\n"
    new_home_lines.insert(4, imports)
    
    with open(file_path, "w", encoding="utf-8") as f:
        f.writelines(new_home_lines)
        
    print("Successfully extracted modals!")
else:
    print("Could not find start or end index.")
