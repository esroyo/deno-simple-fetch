if (import.meta.main) {
  console.log("🧪 Running HTTP Agent Tests...\n");
  
  const testFiles = [
    "./src/utils.test.ts",
    "./src/streams.test.ts", 
    "./src/body-parser.test.ts",
    "./src/agent.test.ts",
    "./src/integration.test.ts"
  ];
  
  for (const testFile of testFiles) {
    console.log(`📝 Running ${testFile}...`);
    const command = new Deno.Command("deno", {
      args: ["test", "--allow-net", "--allow-read", testFile],
    });
    
    const { success } = await command.output();
    if (!success) {
      console.error(`❌ Tests failed in ${testFile}`);
      Deno.exit(1);
    }
  }
  
  console.log("\n✅ All tests passed!");
}
