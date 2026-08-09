import { NhostClient } from "@nhost/nhost-js";

const nhost = new NhostClient({
  subdomain: "mbknwfytawrylgsgbfxw",
  region: "ap-south-1",
  graphqlUrl: "https://mbknwfytawrylgsgbfxw.hasura.ap-south-1.nhost.run/v1/graphql",
  authUrl: "https://mbknwfytawrylgsgbfxw.auth.ap-south-1.nhost.run/v1"
});

async function main() {
  console.log("Testing Nhost client...");
  
  const testEmail = `test_${Date.now()}@example.com`;
  const testPassword = "Password123!";

  console.log("Signing up user:", testEmail);
  const signupRes = await nhost.auth.signUp({
    email: testEmail,
    password: testPassword
  });

  console.log("SignUp Result:", JSON.stringify(signupRes, null, 2));

  const session = signupRes.session || nhost.auth.getSession();

  if (session) {
    const token = session.accessToken;
    console.log("Got access token! Querying GQL...");
    
    const res = await fetch("https://mbknwfytawrylgsgbfxw.hasura.ap-south-1.nhost.run/v1/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        query: `
          query IntrospectionQuery {
            __schema {
              types {
                name
                kind
                fields { name }
              }
            }
          }
        `
      })
    });
    const json = await res.json();
    console.log("GQL Schema for authenticated user:");
    const queryRoot = json.data?.__schema?.types?.find(t => t.name === "query_root");
    console.log("Query Root Fields:", queryRoot?.fields?.map(f => f.name));

    const exposed = json.data?.__schema?.types?.filter(t => 
      !t.name.startsWith("__") && t.kind === "OBJECT"
    );
    console.log("\nExposed Object Types:");
    exposed?.forEach(t => console.log("-", t.name, ":", t.fields?.map(f => f.name).join(", ")));
  }
}

main();
