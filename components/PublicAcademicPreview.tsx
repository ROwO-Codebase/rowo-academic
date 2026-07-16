const completedCourses = [
  { code: "CS 136", grade: "76%", state: "Complete" },
  { code: "CS 136L", grade: "88%", state: "Complete" },
  { code: "MATH 138", grade: "80%", state: "Complete" },
];

export function PublicAcademicPreview() {
  return (
    <div className="preview-frame" aria-label="Example ROwO Academic degree plan">
      <div className="preview-window-bar" aria-hidden="true">
        <span />
        <span />
        <span />
        <strong>Example plan</strong>
      </div>

      <div className="preview-body">
        <div className="preview-heading">
          <div>
            <span className="eyebrow compact">Honours Computer Science</span>
            <h2>Your degree, at a glance</h2>
          </div>
          <span className="calendar-chip">2026–27 calendar</span>
        </div>

        <div className="preview-progress-card">
          <div className="preview-progress-copy">
            <span>Degree progress</span>
            <strong>6.25 / 20.0 units</strong>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Example degree progress"
            aria-valuemin={0}
            aria-valuemax={20}
            aria-valuenow={6.25}
          >
            <span style={{ width: "31.25%" }} />
          </div>
          <div className="preview-progress-meta">
            <span>3.75 completed</span>
            <span>2.50 planned</span>
          </div>
        </div>

        <div className="preview-grid">
          <section className="preview-panel" aria-labelledby="preview-requirements">
            <div className="preview-panel-title">
              <h3 id="preview-requirements">Requirements</h3>
              <span>9 of 18 on track</span>
            </div>
            <div className="mini-requirement">
              <span className="status-dot met" aria-hidden="true">✓</span>
              <div>
                <strong>First-year CS</strong>
                <small>CS 135, 136 and 136L counted</small>
              </div>
            </div>
            <div className="mini-requirement">
              <span className="status-dot planned" aria-hidden="true">↗</span>
              <div>
                <strong>Core CS courses</strong>
                <small>CS 240 and 246 are in your plan</small>
              </div>
            </div>
            <div className="mini-requirement">
              <span className="status-dot unknown" aria-hidden="true">?</span>
              <div>
                <strong>Breadth requirement</strong>
                <small>Needs one course classification</small>
              </div>
            </div>
          </section>

          <section className="preview-panel" aria-labelledby="preview-courses">
            <div className="preview-panel-title">
              <h3 id="preview-courses">Recent courses</h3>
              <span>Winter 2026</span>
            </div>
            <div className="preview-course-list">
              {completedCourses.map((course) => (
                <div className="preview-course" key={course.code}>
                  <div>
                    <strong>{course.code}</strong>
                    <small>{course.state}</small>
                  </div>
                  <span>{course.grade}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="eligibility-callout">
          <span className="status-dot met" aria-hidden="true">✓</span>
          <div>
            <strong>CS 246 is eligible for Fall 2026</strong>
            <small>Your CS 136 grade and CS 136L satisfy the prerequisite.</small>
          </div>
        </div>
      </div>
    </div>
  );
}
