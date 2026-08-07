const fs = require('fs');
const path = require('path');

const files = [
  'schema.sql', 
  'tabs_schema.sql', 
  'stripe_schema.sql', 
  'els_platform_schema.sql', 
  'ride_schema.sql', 
  'sql_migration_ride_marketplace.sql', 
  'create_rides_and_messages.sql'
];

let content = 'BEGIN;\n\n';

for (const file of files) {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    content += `-- ==========================================\n`;
    content += `-- START: ${file}\n`;
    content += `-- ==========================================\n\n`;
    content += fs.readFileSync(filePath, 'utf8') + '\n\n';
  } else {
    console.log(`Skipping ${file}, not found.`);
  }
}

content += '\nCOMMIT;\n';

fs.writeFileSync(path.join(__dirname, 'full_database_setup.sql'), content);
console.log('Combined SQL written to full_database_setup.sql');
