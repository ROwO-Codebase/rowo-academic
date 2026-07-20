/** Build stable external catalog links from a Waterloo course code. */
export function uwflowCourseUrl(courseCode: string): string {
  const compact = courseCode.toLowerCase().replace(/[^a-z0-9]/g, "");
  return "https://uwflow.com/course/" + encodeURIComponent(compact);
}

export function redditCourseSearchUrl(courseCode: string): string {
  const compact = courseCode.toLowerCase().replace(/[^a-z0-9]/g, "");
  const query = compact || courseCode.trim().toLowerCase();
  return "https://www.reddit.com/r/uwaterloo/search/?q=" +
    encodeURIComponent(query);
}

export function waterlooCourseOutlineUrl(courseCode: string): string {
  const compact = courseCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = compact.match(/^([A-Z]+)([0-9][A-Z0-9]*)$/);
  const query = match ? match[1] + " " + match[2] : courseCode.trim();
  return "https://outline.uwaterloo.ca/viewer/?q=" + encodeURIComponent(query);
}
