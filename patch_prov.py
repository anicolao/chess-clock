import re
with open("firmware/components/provisioning/src/provisioning.c", "r") as f:
    c = f.read()

# Remove the debug printf statements from earlier
c = re.sub(r'printf\(".*?"[^\n]*\);\n\s*', '', c)

# Replace calloc with stack allocation
c = c.replace("struct quirc_code *code = calloc(1, sizeof(struct quirc_code));", "struct quirc_code code_obj; struct quirc_code *code = &code_obj; memset(code, 0, sizeof(*code));")
c = c.replace("struct quirc_data *data = calloc(1, sizeof(struct quirc_data));", "struct quirc_data data_obj; struct quirc_data *data = &data_obj; memset(data, 0, sizeof(*data));")

# Remove the free() statements
c = c.replace("free(code);", "")
c = c.replace("free(data);", "")

# Remove the null check loop since stack variables are guaranteed
c = re.sub(r'if \(!code \|\| !data\) \{.*?\n\s+continue;\n\s+\}', '', c, flags=re.DOTALL)

with open("firmware/components/provisioning/src/provisioning.c", "w") as f:
    f.write(c)
