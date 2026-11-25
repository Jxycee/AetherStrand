using UnityEngine;

namespace AetherStrand
{
    /// <summary>
    /// Keeps the hair shader's head-centre (used for the dome normal blend and dome shading) in sync with the head bone.
    /// Authority: local presentation only (no networking).
    /// </summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    public class AetherStrandHeadCenterDriver : MonoBehaviour
    {
        public Transform headBone;
        public Vector3 localCenter = new Vector3(0f, 0.425f, -0.01f);
        public Renderer target;

        static readonly int HeadCenterId = Shader.PropertyToID("_HeadCenterWS");
        MaterialPropertyBlock _mpb;
        readonly System.Collections.Generic.List<Renderer> _rs = new System.Collections.Generic.List<Renderer>();

        void OnEnable() { Apply(); }
        void LateUpdate() { Apply(); }

        /// <summary>Writes the head centre to target, or with no target to every renderer on this object and its children
        /// (the live hair's locks and its hybrid mass child both shade with it).</summary>
        public void Apply()
        {
            if (headBone == null) return;
            if (_mpb == null) _mpb = new MaterialPropertyBlock();
            Vector3 w = headBone.TransformPoint(localCenter);
            _rs.Clear();
            if (target != null) _rs.Add(target); else GetComponentsInChildren(true, _rs);
            foreach (var r in _rs)
            {
                r.GetPropertyBlock(_mpb);
                _mpb.SetVector(HeadCenterId, new Vector4(w.x, w.y, w.z, 0f));
                r.SetPropertyBlock(_mpb);
            }
        }
    }
}
