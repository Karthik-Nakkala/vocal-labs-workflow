import { useState, useEffect } from "react";
import { nhost, gqlRequest } from "./lib/nhost";
import { devStore } from "./lib/devStore";
import AuthScreen from "./components/AuthScreen";
import Navbar from "./components/Navbar";
import OrgManager from "./components/OrgManager";
import WorkflowList from "./components/WorkflowList";
import WorkflowBuilder from "./components/WorkflowBuilder";
import WorkflowRunner from "./components/WorkflowRunner";
import InviteMember from "./components/InviteMember";

function App() {
  const [user, setUser] = useState(() => nhost.getUserSession()?.user ?? null);
  const [organizations, setOrganizations] = useState([]);
  const [currentOrg, setCurrentOrg] = useState(null);
  const [view, setView] = useState("LIST"); // "LIST" | "BUILDER" | "RUNNER"
  const [selectedWorkflow, setSelectedWorkflow] = useState(null);
  const [showOrgModal, setShowOrgModal] = useState(false);
  const [showMembersModal, setShowMembersModal] = useState(false);

  useEffect(() => {
    if (user) {
      fetchUserOrganizations();
    }
  }, [user]);

  useEffect(() => nhost.sessionStorage.onChange((session) => {
    setUser(session?.user ?? null);
  }), []);

  const fetchUserOrganizations = async () => {
    try {
      const data = await gqlRequest(`
        query GetUserOrganizations {
          organization_members {
            id
            role
            organization {
              id
              name
              calls_used
              max_quota
            }
          }
        }
      `);

      let orgList = (data?.organization_members || [])
        .filter((m) => m.organization)
        .map((m) => ({
          id: m.organization.id,
          name: m.organization.name,
          calls_used: m.organization.calls_used || 0,
          max_quota: m.organization.max_quota || 100,
          membershipRole: m.role
        }));

      if (orgList.length === 0) {
        try {
          const directOrgs = await gqlRequest(`
            query DirectOrgs {
              organizations {
                id
                name
                calls_used
                max_quota
              }
            }
          `);
          orgList = (directOrgs?.organizations || []).map(o => ({
            id: o.id,
            name: o.name,
            calls_used: o.calls_used || 0,
            max_quota: o.max_quota || 100,
            membershipRole: "owner"
          }));
        } catch (e) {
          console.warn("Direct orgs query note:", e.message);
        }
      }

      if (orgList.length === 0 && user) {
        const cleanName = user.email ? user.email.split("@")[0] : "New Developer";
        const capitalized = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
        const autoOrgName = `${capitalized}'s Organization`;

        try {
          const createOrgRes = await gqlRequest(`
            mutation AutoCreateOrgForUser($name: String!) {
              insert_organizations_one(object: { name: $name }) {
                id
                name
                calls_used
                max_quota
              }
            }
          `, { name: autoOrgName });

          const newOrg = createOrgRes?.insert_organizations_one;
          if (newOrg) {
            try {
              await gqlRequest(`
                mutation AutoLinkMember($org_id: uuid!, $user_id: uuid!) {
                  insert_organization_members_one(object: {
                    org_id: $org_id,
                    user_id: $user_id,
                    role: "owner"
                  }) {
                    id
                  }
                }
              `, {
                org_id: newOrg.id,
                user_id: user.id && user.id.includes("-") ? user.id : "00000000-0000-0000-0000-000000000001"
              });
            } catch (mErr) {
              console.warn("Member link note:", mErr.message);
            }

            orgList = [{
              id: newOrg.id,
              name: newOrg.name,
              calls_used: newOrg.calls_used || 0,
              max_quota: newOrg.max_quota || 100,
              membershipRole: "owner"
            }];
          }
        } catch (autoErr) {
          console.error("Auto org creation error:", autoErr.message);
        }
      }

      setOrganizations(orgList);
      if (orgList.length > 0) {
        setCurrentOrg((prev) => (prev && orgList.some(o => o.id === prev.id) ? prev : orgList[0]));
      }
    } catch (err) {
      console.error("Fetch user organizations error:", err.message);
    }
  };

  const handleLoginSuccess = (userData) => {
    setUser(userData);
  };

  const handleLogout = async () => {
    try {
      await nhost.auth.signOut();
    } catch (e) {
      // Ignore signout error
    }
    nhost.clearSession();
    setUser(null);
    setOrganizations([]);
    setCurrentOrg(null);
    setView("LIST");
  };

  if (!user) {
    return <AuthScreen onAuthSuccess={handleLoginSuccess} />;
  }

  return (
    <div style={{ minHeight: "100vh", paddingBottom: "3rem" }}>
      <Navbar
        user={user}
        organizations={organizations}
        currentOrg={currentOrg}
        onSelectOrg={(org) => {
          setCurrentOrg(org);
          setView("LIST");
        }}
        onOpenCreateOrgModal={() => setShowOrgModal(true)}
        onOpenMembersModal={() => setShowMembersModal(true)}
        onLogout={handleLogout}
      />

      {showOrgModal && (
        <OrgManager
          onClose={() => setShowOrgModal(false)}
          onOrgCreated={(newOrg) => {
            fetchUserOrganizations();
            setCurrentOrg({ ...newOrg, membershipRole: "owner" });
          }}
        />
      )}

      {showMembersModal && currentOrg && (
        <InviteMember
          currentOrg={currentOrg}
          userRole={currentOrg.membershipRole || "viewer"}
          onClose={() => setShowMembersModal(false)}
          onMembersUpdated={fetchUserOrganizations}
        />
      )}

      {view === "LIST" && (
        <WorkflowList
          currentOrg={currentOrg}
          onSelectWorkflow={(wf) => {
            setSelectedWorkflow(wf);
            setView("BUILDER");
          }}
          onCreateNewWorkflow={() => {
            setSelectedWorkflow(null);
            setView("BUILDER");
          }}
          onRunWorkflow={(wf) => {
            setSelectedWorkflow(wf);
            setView("RUNNER");
          }}
        />
      )}

      {view === "BUILDER" && (
        <WorkflowBuilder
          currentOrg={currentOrg}
          workflowToEdit={selectedWorkflow}
          onBack={() => setView("LIST")}
          onSaveSuccess={() => {
            setView("LIST");
          }}
        />
      )}

      {view === "RUNNER" && selectedWorkflow && (
        <WorkflowRunner
          currentOrg={currentOrg}
          workflow={selectedWorkflow}
          onBack={() => setView("LIST")}
        />
      )}
    </div>
  );
}

export default App;
