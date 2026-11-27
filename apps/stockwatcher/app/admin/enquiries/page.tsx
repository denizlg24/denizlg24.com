import type { Metadata } from "next";
import { count } from "@/components/admin/format";
import { requireAdmin } from "@/lib/admin";
import { listEnquiries } from "@/lib/enquiries";

export const metadata: Metadata = {
  title: "Enquiries · Stockwatcher",
  robots: { index: false, follow: false },
};

const stamp = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

const utc = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : stamp.format(date);
};

export default async function AdminEnquiries() {
  await requireAdmin();
  const enquiries = await listEnquiries();

  return (
    <>
      <header className="view-header">
        <h1>Enquiries</h1>
        <p className="meta">Desk and usage enquiries from /enquire</p>
      </header>

      <section className="section" aria-labelledby="admin-enquiries">
        <header className="section-head">
          <div>
            <h2 id="admin-enquiries">Received</h2>
            <p>Newest first · times in UTC</p>
          </div>
        </header>
        {enquiries.length ? (
          <div className="admin-scroll">
            <table className="data-table admin-enquiries">
              <thead>
                <tr>
                  <th>Received</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Company</th>
                  <th>Role</th>
                  <th>Seats</th>
                  <th>Interest</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {enquiries.map((enquiry) => (
                  <tr key={enquiry.id}>
                    <td className="num">
                      <time dateTime={enquiry.createdAt}>
                        {utc(enquiry.createdAt)}
                      </time>
                    </td>
                    <td>{enquiry.name}</td>
                    <td>
                      <a href={`mailto:${enquiry.email}`}>{enquiry.email}</a>
                    </td>
                    <td className="muted">{enquiry.company ?? "—"}</td>
                    <td className="muted">{enquiry.role ?? "—"}</td>
                    <td className="muted">{enquiry.seats ?? "—"}</td>
                    <td>{enquiry.interest}</td>
                    <td className="admin-enquiry-message">{enquiry.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <strong>No enquiries yet.</strong>
            <p>Submissions from the desk enquiry page appear here.</p>
          </div>
        )}
        <footer className="section-foot">
          <span>
            {count(enquiries.length)} shown
            {enquiries.length >= 200 ? " · latest 200" : ""}
          </span>
        </footer>
      </section>
    </>
  );
}
